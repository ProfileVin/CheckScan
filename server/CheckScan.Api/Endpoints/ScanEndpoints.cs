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
                await twainThread.RunOnTwainThread(() => scanService.StartScan(request?.SingleScan ?? false));
            }
            catch (ScannerException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }

            return Results.Accepted();
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

    public record StartScanRequest(bool SingleScan = false);
}
