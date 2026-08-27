using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace CheckScan.Api.Storage;

/// <summary>
/// Holds the Azure SQL and Azure Blob connection strings encrypted at rest with DPAPI
/// (<see cref="DataProtectionScope.CurrentUser"/>), so they are never kept in plain-text
/// config. The plaintext form is a small JSON map (<c>{"db":"...","blob":"..."}</c>)
/// written to <c>%LOCALAPPDATA%\CheckScan\secrets.dat</c>.
///
/// For local development, an unset key falls back to the matching entry under
/// <c>ConnectionStrings</c> in configuration so <c>dotnet run</c> keeps working without
/// having to seed the encrypted file first.
/// </summary>
public sealed class SecretStore
{
    private const string DbKey = "db";
    private const string BlobKey = "blob";

    private readonly IConfiguration _configuration;
    private readonly ILogger<SecretStore> _logger;
    private readonly string _filePath;
    private readonly object _lock = new();

    public SecretStore(IConfiguration configuration, ILogger<SecretStore> logger)
    {
        _configuration = configuration;
        _logger = logger;

        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "CheckScan");
        Directory.CreateDirectory(dir);
        _filePath = Path.Combine(dir, "secrets.dat");
    }

    /// <summary>Azure SQL connection string, or null if neither the encrypted file nor config has one.</summary>
    public string? GetDb() => Get(DbKey, "ConnectionStrings:DefaultConnection");

    /// <summary>Azure Blob Storage connection string, or null if unset.</summary>
    public string? GetBlob() => Get(BlobKey, "ConnectionStrings:AzureBlobStorage");

    public void SetDb(string? connectionString) => Set(DbKey, connectionString);

    public void SetBlob(string? connectionString) => Set(BlobKey, connectionString);

    public bool HasDb() => !string.IsNullOrWhiteSpace(GetDb());

    public bool HasBlob() => !string.IsNullOrWhiteSpace(GetBlob());

    private string? Get(string key, string configFallbackPath)
    {
        lock (_lock)
        {
            var map = Read();
            if (map.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value))
            {
                return value;
            }
        }

        var fromConfig = _configuration[configFallbackPath];
        return string.IsNullOrWhiteSpace(fromConfig) ? null : fromConfig;
    }

    private void Set(string key, string? connectionString)
    {
        lock (_lock)
        {
            var map = Read();
            if (string.IsNullOrWhiteSpace(connectionString))
            {
                map.Remove(key);
            }
            else
            {
                map[key] = connectionString.Trim();
            }
            Write(map);
        }
    }

    private Dictionary<string, string> Read()
    {
        try
        {
            if (!File.Exists(_filePath)) return new();

            var encrypted = File.ReadAllBytes(_filePath);
            var plaintext = ProtectedData.Unprotect(encrypted, null, DataProtectionScope.CurrentUser);
            var json = Encoding.UTF8.GetString(plaintext);
            return JsonSerializer.Deserialize<Dictionary<string, string>>(json) ?? new();
        }
        catch (Exception ex)
        {
            // A corrupt or undecryptable file (e.g. copied from another machine/user) must not
            // crash startup - treat it as "no secrets yet" and let the user re-enter them.
            _logger.LogWarning(ex, "Could not read {File}; treating secrets as unset.", _filePath);
            return new();
        }
    }

    private void Write(Dictionary<string, string> map)
    {
        var json = JsonSerializer.Serialize(map);
        var encrypted = ProtectedData.Protect(
            Encoding.UTF8.GetBytes(json), null, DataProtectionScope.CurrentUser);
        File.WriteAllBytes(_filePath, encrypted);
    }
}
