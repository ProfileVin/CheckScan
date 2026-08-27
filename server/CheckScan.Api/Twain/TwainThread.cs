using System.Windows.Forms;
using NTwain;

namespace CheckScan.Api.Twain;

/// <summary>
/// Owns the single dedicated STA thread with an invisible WinForms window that TWAIN
/// requires as its "parent" and message pump. ASP.NET request-handling threads never
/// touch TWAIN directly - they call <see cref="RunOnTwainThread{T}"/>, which marshals
/// the work onto this thread via the hidden form's <c>Invoke</c>.
/// </summary>
public sealed class TwainThread : IDisposable
{
    private sealed class HiddenForm : Form
    {
        protected override void SetVisibleCore(bool value) => base.SetVisibleCore(false);
    }

    private readonly ILogger<TwainThread> _logger;
    private Thread? _thread;
    private HiddenForm? _form;
    private readonly TaskCompletionSource _ready = new();

    public nint WindowHandle { get; private set; }

    public TwainThread(ILogger<TwainThread> logger)
    {
        _logger = logger;
    }

    public void Start()
    {
        _thread = new Thread(RunMessageLoop)
        {
            IsBackground = true,
            Name = "TwainThread",
        };
        _thread.SetApartmentState(ApartmentState.STA);
        _thread.Start();
    }

    public Task WaitUntilReadyAsync() => _ready.Task;

    /// <summary>Creates the hook NTwain needs to pump TWAIN messages through this thread's loop.</summary>
    public MessageLoopHook CreateMessageLoopHook() => new WindowsFormsMessageLoopHook(WindowHandle);

    public Task<T> RunOnTwainThread<T>(Func<T> work)
    {
        var tcs = new TaskCompletionSource<T>();
        _form!.BeginInvoke(() =>
        {
            try
            {
                tcs.SetResult(work());
            }
            catch (Exception ex)
            {
                tcs.SetException(ex);
            }
        });
        return tcs.Task;
    }

    public Task RunOnTwainThread(Action work) => RunOnTwainThread<object?>(() =>
    {
        work();
        return null;
    });

    private void RunMessageLoop()
    {
        // Without this, an exception raised inside a callback dispatched through the message
        // loop (e.g. NTwain's DataTransferred/TransferReady/TransferError event handlers) is
        // unhandled and takes down the entire process - there's no request/response boundary
        // to catch it like there is for RunOnTwainThread's own explicit work items.
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, e) =>
            _logger.LogError(e.Exception, "Unhandled exception on the TWAIN message loop thread.");

        _form = new HiddenForm();
        WindowHandle = _form.Handle; // forces native handle creation
        _ready.SetResult();
        Application.Run();
    }

    public void Dispose()
    {
        if (_form is { IsDisposed: false })
        {
            _form.BeginInvoke(Application.ExitThread);
        }
    }
}
