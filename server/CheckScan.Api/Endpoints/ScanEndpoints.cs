using System.Net.WebSockets;
using CheckScan.Api.Twain;

namespace CheckScan.Api.Endpoints;

public static class ScanEndpoints
{
    public static void MapScanEndpoints(this WebApplication app)
    {
        app.MapPost("/scan", async (StartScanRequest? request, TwainThread twainThread, TwainScanService scanService) =>
        {
            try
            {
                await twainThread.RunOnTwainThread(() => scanService.StartScan(request?.UseFeeder));
            }
            catch (ScannerException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }

            return Results.Accepted();
        });

        // Lets the UI tell the user whether to load the feeder or place a check on the glass.
        app.MapGet("/scan/feeder-status", async (TwainThread twainThread, TwainScanService scanService, ILogger<Program> logger) =>
        {
            try
            {
                var status = await twainThread.RunOnTwainThread(() =>
                    new { hasFeeder = scanService.FeederSupported, feederLoaded = scanService.FeederLoaded() });
                return Results.Ok(status);
            }
            catch (ScannerException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to read scanner feeder status.");
                return Results.Json(new { error = ex.Message }, statusCode: StatusCodes.Status500InternalServerError);
            }
        });

        app.Map("/ws/scan", async (HttpContext context, ScanBroadcaster broadcaster) =>
        {
            if (!context.WebSockets.IsWebSocketRequest)
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                return;
            }

            using var socket = await context.WebSockets.AcceptWebSocketAsync();
            await broadcaster.RegisterAndPumpAsync(socket, context.RequestAborted);
        });
    }

    /// <summary>null (default) auto-selects feeder vs flatbed from the scanner's capabilities.</summary>
    public record StartScanRequest(bool? UseFeeder = null);
}
