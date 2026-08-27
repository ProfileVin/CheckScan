using Azure.Storage.Blobs;
using CheckScan.Api.Data;
using CheckScan.Api.Storage;
using Microsoft.EntityFrameworkCore;

namespace CheckScan.Api.Endpoints;

/// <summary>
/// Lets the Electron Settings page seed the Azure SQL and Azure Blob connection strings,
/// which are then held DPAPI-encrypted by <see cref="SecretStore"/> rather than in
/// plain-text config. Values are write-only over the wire - status returns booleans only.
/// </summary>
public static class SettingsEndpoints
{
    public static void MapSettingsEndpoints(this WebApplication app)
    {
        app.MapGet("/settings/status", (SecretStore secrets) =>
            Results.Ok(new { db = secrets.HasDb(), blob = secrets.HasBlob() }));

        app.MapPost("/settings/db-connection", async (
            ConnectionStringRequest request, SecretStore secrets, IServiceScopeFactory scopeFactory) =>
        {
            if (string.IsNullOrWhiteSpace(request.ConnectionString))
            {
                return Results.BadRequest(new { error = "Connection string is required." });
            }

            var previous = secrets.GetDb();
            secrets.SetDb(request.ConnectionString);

            try
            {
                // A fresh scope so the DbContext is built from the string we just saved (the
                // request's own context was created before SetDb and still has the old one).
                // Proves the new target is reachable and brings its schema up to date now, rather
                // than letting the next save-a-check call be the first thing that hits a bad string.
                await using var scope = scopeFactory.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<CheckScanDbContext>();
                await db.Database.MigrateAsync();
                return Results.Ok(new { ok = true });
            }
            catch (Exception ex)
            {
                secrets.SetDb(previous); // roll back so a bad string doesn't stick
                return Results.BadRequest(new { error = $"Could not connect with that string: {ex.Message}" });
            }
        });

        app.MapPost("/settings/blob-connection", async (
            ConnectionStringRequest request, SecretStore secrets) =>
        {
            if (string.IsNullOrWhiteSpace(request.ConnectionString))
            {
                return Results.BadRequest(new { error = "Connection string is required." });
            }

            try
            {
                await new BlobServiceClient(request.ConnectionString).GetPropertiesAsync();
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new { error = $"Could not connect to Azure Blob Storage: {ex.Message}" });
            }

            secrets.SetBlob(request.ConnectionString);
            return Results.Ok(new { ok = true });
        });
    }

    public record ConnectionStringRequest(string ConnectionString);
}
