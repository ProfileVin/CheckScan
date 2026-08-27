using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;

namespace CheckScan.Api.Storage;

/// <summary>
/// Stores confirmed check images in a private Azure Blob Storage container. Selected when
/// <c>ImageStorage:Provider</c> is <c>AzureBlob</c>. Modelled on the KolHaNitzachon phone
/// system's <c>AzureRecordingStorageService</c>.
///
/// A blob outage must never lose a reviewed check: on any failure (including a missing
/// connection string) this falls back to <see cref="LocalCheckImageStore"/> for that one
/// image, so <c>POST /checks</c> still succeeds.
/// </summary>
public sealed class AzureBlobCheckImageStore : ICheckImageStore
{
    private const string DefaultContainerName = "check-images";

    private readonly SecretStore _secrets;
    private readonly string _containerName;
    private readonly LocalCheckImageStore _localFallback;
    private readonly ILogger<AzureBlobCheckImageStore> _logger;

    public AzureBlobCheckImageStore(
        SecretStore secrets,
        IConfiguration configuration,
        LocalCheckImageStore localFallback,
        ILogger<AzureBlobCheckImageStore> logger)
    {
        _secrets = secrets;
        _containerName = configuration["AzureBlobStorage:ContainerName"] is { Length: > 0 } name
            ? name
            : DefaultContainerName;
        _localFallback = localFallback;
        _logger = logger;
    }

    public async Task<string> PutConfirmedAsync(string localSpoolPath, CancellationToken ct = default)
    {
        var connectionString = _secrets.GetBlob();
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            _logger.LogWarning(
                "ImageStorage:Provider is AzureBlob but no blob connection string is set - " +
                "storing {ImagePath} locally instead. Add one in Settings.", localSpoolPath);
            return await _localFallback.PutConfirmedAsync(localSpoolPath, ct);
        }

        try
        {
            var containerClient = new BlobServiceClient(connectionString)
                .GetBlobContainerClient(_containerName);
            await containerClient.CreateIfNotExistsAsync(PublicAccessType.None, cancellationToken: ct);

            var now = DateTime.UtcNow;
            var blobName = $"checks/{now:yyyy}/{now:MM}/{Path.GetFileName(localSpoolPath)}";
            var blobClient = containerClient.GetBlobClient(blobName);

            await using (var file = File.OpenRead(localSpoolPath))
            {
                await blobClient.UploadAsync(file, new BlobUploadOptions
                {
                    HttpHeaders = new BlobHttpHeaders { ContentType = "image/jpeg" },
                }, ct);
            }

            TryDeleteLocal(localSpoolPath);
            _logger.LogInformation("Uploaded confirmed check image to blob {BlobName}.", blobName);
            return blobName;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex,
                "Failed to upload {ImagePath} to Azure Blob Storage; storing it locally instead.",
                localSpoolPath);
            return await _localFallback.PutConfirmedAsync(localSpoolPath, ct);
        }
    }

    private void TryDeleteLocal(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch (IOException ex)
        {
            // The upload succeeded - a leftover local copy is harmless, just noisy.
            _logger.LogWarning(ex, "Uploaded {ImagePath} but could not delete the local copy.", path);
        }
    }
}
