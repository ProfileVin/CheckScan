using CheckScan.Api.Twain;

namespace CheckScan.Api.Storage;

/// <summary>
/// Default image store: keeps confirmed check images on local disk, moving them out of the
/// scan spool into the <c>Processed</c> folder. This is the behaviour CheckScan has always had;
/// it was previously a private helper in <c>CheckEndpoints</c>.
/// </summary>
public sealed class LocalCheckImageStore(ImageStorageOptions imageStorage, ILogger<LocalCheckImageStore> logger)
    : ICheckImageStore
{
    public Task<string> PutConfirmedAsync(string localSpoolPath, CancellationToken ct = default)
        => Task.FromResult(MoveToProcessed(localSpoolPath));

    /// <summary>
    /// Moves a confirmed check's image out of the scan root into the Processed folder. Falls back
    /// to the original path on any I/O failure - a moved-image hiccup shouldn't block saving the
    /// reviewed check data, which is the part the user actually cares about losing.
    /// </summary>
    private string MoveToProcessed(string imagePath)
    {
        try
        {
            if (!File.Exists(imagePath)) return imagePath;

            var destination = Path.Combine(imageStorage.ProcessedPath, Path.GetFileName(imagePath));
            File.Move(imagePath, destination, overwrite: true);
            return destination;
        }
        catch (IOException ex)
        {
            logger.LogWarning(ex, "Failed to move {ImagePath} to the Processed folder; keeping original path.", imagePath);
            return imagePath;
        }
    }
}
