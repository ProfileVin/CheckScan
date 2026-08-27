using System.Drawing;
using System.Drawing.Imaging;
using System.Reflection;
using NTwain;
using NTwain.Data;

namespace CheckScan.Api.Twain;

public record ScannerDto(string Id, string Name);

public class ScannerException(string message) : Exception(message);

/// <summary>
/// Wraps an NTwain <see cref="TwainSession"/>: enumerating sources, negotiating feeder
/// capabilities, and driving a batch scan. All public methods must be called via
/// <see cref="TwainThread.RunOnTwainThread{T}"/> - this class assumes it's already
/// running on that thread.
/// </summary>
public sealed class TwainScanService
{
    private readonly TwainThread _twainThread;
    private readonly ScanBroadcaster _broadcaster;
    private readonly ILogger<TwainScanService> _logger;
    private readonly ImageStorageOptions _imageStorage;

    private TwainSession? _session;
    private DataSource? _currentSource;
    private int _scannedCount;

    public TwainScanService(TwainThread twainThread, ScanBroadcaster broadcaster, ILogger<TwainScanService> logger, ImageStorageOptions imageStorage)
    {
        _twainThread = twainThread;
        _broadcaster = broadcaster;
        _logger = logger;
        _imageStorage = imageStorage;
    }

    private TwainSession Session
    {
        get
        {
            if (_session is not null) return _session;

            var appId = TWIdentity.CreateFromAssembly(DataGroups.Image, Assembly.GetExecutingAssembly());
            _session = new TwainSession(appId);
            _session.Open(_twainThread.CreateMessageLoopHook());
            _session.DataTransferred += OnDataTransferred;
            _session.TransferReady += OnTransferReady;
            _session.TransferError += OnTransferError;
            return _session;
        }
    }

    public List<ScannerDto> GetSources() =>
        Session.GetSources().Select(s => new ScannerDto(s.Id.ToString(), s.Name)).ToList();

    public void SelectSource(string sourceId)
    {
        _currentSource?.Close();
        var rc = Session.OpenSource(int.Parse(sourceId));
        if (rc != ReturnCode.Success || Session.CurrentSource is null)
        {
            throw new ScannerException($"Scanner '{sourceId}' could not be opened.");
        }
        _currentSource = Session.CurrentSource;
    }

    /// <summary>
    /// Configures the feeder and triggers a scan. When <paramref name="singleScan"/> is true, the
    /// feeder is explicitly disabled (flatbed mode) to capture exactly one check; otherwise the
    /// feeder/auto-feed is enabled to drain the whole hopper. Results stream via <see cref="ScanBroadcaster"/>.
    /// </summary>
    public void StartScan(bool singleScan)
    {
        var source = _currentSource ?? throw new ScannerException("No scanner selected. Call /scanners/select first.");

        if (singleScan)
        {
            // Flatbed mode: just not turning the feeder on isn't enough - some drivers default to
            // (or remember) ADF mode, so it has to be explicitly turned off here.
            if (source.Capabilities.CapFeederEnabled.IsSupported)
            {
                source.Capabilities.CapFeederEnabled.SetValue(BoolType.False);
            }
        }
        else
        {
            source.Capabilities.CapFeederEnabled.SetValue(BoolType.True);
            source.Capabilities.CapAutoFeed.SetValue(BoolType.True);
        }

        // Native transfer previously caused a fatal native-level crash (STATUS_STACK_BUFFER_OVERRUN)
        // that no managed try/catch could intercept - but that turned out to be a 64-bit host /
        // 32-bit driver mismatch (see CheckScan.Api.csproj's PlatformTarget), not a Native-transfer
        // problem per se. Now that the process runs x86 (matching the known-working TwainTest
        // reference app, which also uses Native), we're back on Native transfer: manual Memory-
        // transfer buffer reconstruction was producing incomplete images (only a top strip filled,
        // rest black) because this driver's memory-chunk delivery didn't match our reassembly logic.
        source.Capabilities.ICapXferMech.SetValue(XferMech.Native);

        // CAP_FEEDERLOADED only applies in feeder mode - flatbed scans have no "feeder loaded"
        // concept, so this pre-check is skipped entirely for a single/flatbed scan.
        if (!singleScan)
        {
            // CAP_FEEDERLOADED is only trustworthy on some drivers once IsSupported is true; several
            // TWAIN drivers (observed with an Epson feeder) report it unreliably before the source
            // is actually enabled. Only hard-block when the driver both supports the query and gives
            // a confident "no" - otherwise let Enable() itself be the source of truth and surface any
            // real failure via TransferError below.
            var feederLoadedCap = source.Capabilities.CapFeederLoaded;
            if (feederLoadedCap.IsSupported)
            {
                var feederLoaded = feederLoadedCap.GetCurrent();
                _logger.LogInformation("CapFeederLoaded reports {FeederLoaded}", feederLoaded);
                if (feederLoaded == BoolType.False)
                {
                    throw new ScannerException("Feeder is empty - load checks before scanning.");
                }
            }
            else
            {
                _logger.LogInformation("CapFeederLoaded is not supported by this driver - skipping the pre-check.");
            }
        }

        _scannedCount = 0;
        source.Enable(SourceEnableMode.NoUI, false, _twainThread.WindowHandle);
    }

    private void OnDataTransferred(object? sender, DataTransferredEventArgs e)
    {
        try
        {
            using var bitmap = BuildBitmap(e);
            if (bitmap is null) return;

            var fileName = $"{DateTime.UtcNow:yyyyMMdd-HHmmss}-{_scannedCount:D3}.jpg";
            var path = Path.Combine(_imageStorage.RootPath, fileName);

            var jpegEncoder = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);
            using var encoderParams = new EncoderParameters(1);
            encoderParams.Param[0] = new EncoderParameter(Encoder.Quality, 90L);
            bitmap.Save(path, jpegEncoder, encoderParams);

            var index = _scannedCount++;
            _ = _broadcaster.BroadcastCheckScannedAsync(index, path, done: false);
        }
        catch (Exception ex)
        {
            // A failure converting/saving one page must not crash the TWAIN message loop
            // thread (which would take down the whole process) or silently stall the batch.
            _logger.LogError(ex, "Failed to process a scanned page.");
            _ = _broadcaster.BroadcastScanErrorAsync($"Failed to process a scanned page: {ex.Message}");
        }
    }

    /// <summary>
    /// Builds a <see cref="Bitmap"/> from the transferred page. Native transfer (the normal path
    /// now - see <see cref="StartScan"/>) hands us a ready-to-read native image stream. The Memory
    /// transfer branch is kept as a fallback in case a future driver needs it, but is not currently
    /// selected by <see cref="StartScan"/>.
    /// </summary>
    private static Bitmap? BuildBitmap(DataTransferredEventArgs e)
    {
        if (e.TransferType != XferMech.Memory)
        {
            using var stream = e.GetNativeImageStream();
            if (stream is null) return null;

            // Bitmap(stream) keeps a live reference to the stream for lazy pixel access - saving
            // it after the `using` above disposes that stream throws a generic GDI+ error. Cloning
            // into a fresh Bitmap materializes an independent pixel buffer before the stream closes.
            using var lazy = new Bitmap(stream);
            return new Bitmap(lazy);
        }

        var info = e.ImageInfo ?? throw new InvalidOperationException("Memory transfer completed with no ImageInfo.");
        var data = e.MemoryData ?? throw new InvalidOperationException("Memory transfer completed with no MemoryData.");

        var width = info.ImageWidth;
        var height = info.ImageLength;
        var format = info.BitsPerPixel switch
        {
            24 => PixelFormat.Format24bppRgb,
            8 => PixelFormat.Format8bppIndexed,
            1 => PixelFormat.Format1bppIndexed,
            var bpp => throw new NotSupportedException($"Unsupported memory-transfer bit depth: {bpp}bpp"),
        };

        var bitmap = new Bitmap(width, height, format);
        var bmpData = bitmap.LockBits(new Rectangle(0, 0, width, height), ImageLockMode.WriteOnly, format);
        try
        {
            var byteCount = Math.Min(data.Length, bmpData.Stride * height);
            System.Runtime.InteropServices.Marshal.Copy(data, 0, bmpData.Scan0, byteCount);
        }
        finally
        {
            bitmap.UnlockBits(bmpData);
        }

        if (format == PixelFormat.Format8bppIndexed)
        {
            var palette = bitmap.Palette;
            for (var i = 0; i < 256; i++) palette.Entries[i] = Color.FromArgb(i, i, i);
            bitmap.Palette = palette;
        }

        return bitmap;
    }

    private void OnTransferReady(object? sender, TransferReadyEventArgs e)
    {
        if (e.PendingTransferCount == 0)
        {
            _currentSource?.Close();
            _ = _broadcaster.BroadcastCheckScannedAsync(_scannedCount, string.Empty, done: true);
        }
    }

    private void OnTransferError(object? sender, TransferErrorEventArgs e)
    {
        _logger.LogWarning(e.Exception, "TWAIN transfer error: {ReturnCode} {Status}", e.ReturnCode, e.SourceStatus);
        _currentSource?.Close();
        _ = _broadcaster.BroadcastScanErrorAsync($"Scan failed: {e.ReturnCode}");
    }
}
