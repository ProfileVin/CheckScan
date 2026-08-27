namespace CheckScan.Api.Twain;

/// <summary>
/// Resolves and creates the folders scanned check images live in: <see cref="RootPath"/> for
/// freshly scanned, unreviewed images, and <see cref="ProcessedPath"/> for images whose check
/// has been reviewed and confirmed (see <c>CheckEndpoints.MapCheckEndpoints</c>).
/// </summary>
public sealed class ImageStorageOptions
{
    public string RootPath { get; }
    public string ProcessedPath { get; }

    public ImageStorageOptions(IConfiguration config)
    {
        var configuredRoot = config["ImageStorage:RootPath"];
        RootPath = string.IsNullOrWhiteSpace(configuredRoot)
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CheckScan", "Images")
            : configuredRoot;
        ProcessedPath = Path.Combine(RootPath, "Processed");

        Directory.CreateDirectory(RootPath);
        Directory.CreateDirectory(ProcessedPath);
    }
}
