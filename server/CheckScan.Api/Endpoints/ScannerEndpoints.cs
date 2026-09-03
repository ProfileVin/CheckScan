using CheckScan.Api.Data;
using CheckScan.Api.Data.Entities;
using CheckScan.Api.Twain;
using Microsoft.EntityFrameworkCore;

namespace CheckScan.Api.Endpoints;

public static class ScannerEndpoints
{
    public static void MapScannerEndpoints(this WebApplication app)
    {
        app.MapGet("/scanners", async (TwainThread twainThread, TwainScanService scanService) =>
        {
            var sources = await twainThread.RunOnTwainThread(scanService.GetSources);
            return Results.Ok(sources);
        });

        app.MapGet("/scanners/current", async (CheckScanDbContext db, ILogger<Program> logger) =>
        {
            try
            {
                var preference = await db.ScannerPreferences.OrderBy(p => p.Id).FirstOrDefaultAsync();
                return Results.Ok(preference is null
                    ? null
                    : new { preference.SourceId, preference.SourceName });
            }
            catch (Exception ex)
            {
                // No saved preference is a perfectly normal answer when the DB is unreachable -
                // don't block scanner selection (which doesn't need the DB) on this failing.
                logger.LogWarning(ex, "Could not read scanner preference - check ConnectionStrings:DefaultConnection.");
                return Results.Ok(null);
            }
        });

        app.MapPost("/scanners/select", async (SelectScannerRequest request, TwainThread twainThread,
            TwainScanService scanService, CheckScanDbContext db, ILogger<Program> logger) =>
        {
            try
            {
                await twainThread.RunOnTwainThread(() => scanService.SelectSource(request.SourceId));
            }
            catch (ScannerException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }

            try
            {
                var existing = await db.ScannerPreferences.OrderBy(p => p.Id).FirstOrDefaultAsync();
                if (existing is null)
                {
                    db.ScannerPreferences.Add(new ScannerPreference
                    {
                        SourceId = request.SourceId,
                        SourceName = request.SourceName,
                    });
                }
                else
                {
                    existing.SourceId = request.SourceId;
                    existing.SourceName = request.SourceName;
                }
                await db.SaveChangesAsync();
            }
            catch (Exception ex)
            {
                // The scanner is selected and usable either way; only the "remember it for
                // next time" persistence needs the database. Don't fail the whole request.
                logger.LogWarning(ex, "Could not persist scanner preference - check ConnectionStrings:DefaultConnection.");
            }

            return Results.Ok();
        });

        // Backs the Settings page "Test Connection" button: physically re-opens the selected
        // TWAIN source (via FeederLoaded -> EnsureSourceOpen) so a missing/unplugged scanner
        // surfaces as a 400 with the ScannerException message.
        app.MapPost("/scanners/test", async (TwainThread twainThread, TwainScanService scanService) =>
        {
            try
            {
                var result = await twainThread.RunOnTwainThread(() => new
                {
                    ok = true,
                    hasFeeder = scanService.FeederSupported,
                    feederLoaded = scanService.FeederLoaded(),
                });
                return Results.Ok(result);
            }
            catch (ScannerException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });
    }

    public record SelectScannerRequest(string SourceId, string SourceName);
}
