namespace CheckScan.Api.Storage;

/// <summary>
/// Persists a check image once its extracted data has been reviewed and confirmed. During
/// scanning the image sits in the local scan spool (<see cref="Twain.ImageStorageOptions.RootPath"/>);
/// this is called from <c>POST /checks</c> to move it to its permanent home.
/// </summary>
public interface ICheckImageStore
{
    /// <summary>
    /// Takes the confirmed check's image from its local scan-spool path and stores it permanently.
    /// Returns the reference to persist on <c>Check.ImagePath</c> - a local <c>Processed</c> path
    /// for the local store, or a blob name for the Azure store.
    /// </summary>
    Task<string> PutConfirmedAsync(string localSpoolPath, CancellationToken ct = default);
}
