using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace CheckScan.Api.Twain;

/// <summary>Fan-outs each scanned check to every connected /ws/scan client as JSON.</summary>
public sealed class ScanBroadcaster
{
    private readonly List<WebSocket> _sockets = new();
    private readonly object _lock = new();

    public async Task RegisterAndPumpAsync(WebSocket socket, CancellationToken cancellationToken)
    {
        lock (_lock) { _sockets.Add(socket); }
        try
        {
            var buffer = new byte[1024];
            // Keep the connection open; the client only receives, doesn't send.
            while (socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
            {
                var result = await socket.ReceiveAsync(buffer, cancellationToken);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, null, cancellationToken);
                    break;
                }
            }
        }
        finally
        {
            lock (_lock) { _sockets.Remove(socket); }
        }
    }

    public Task BroadcastCheckScannedAsync(int index, string imagePath, bool done) =>
        BroadcastAsync(new { type = "check-scanned", index, imagePath, done });

    public Task BroadcastScanErrorAsync(string message) =>
        BroadcastAsync(new { type = "scan-error", message });

    private async Task BroadcastAsync(object payload)
    {
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload));

        List<WebSocket> targets;
        lock (_lock) { targets = _sockets.Where(s => s.State == WebSocketState.Open).ToList(); }

        foreach (var socket in targets)
        {
            try
            {
                await socket.SendAsync(bytes, WebSocketMessageType.Text, endOfMessage: true, CancellationToken.None);
            }
            catch (WebSocketException)
            {
                // Client disconnected mid-send; it'll be pruned on its next receive loop iteration.
            }
        }
    }
}
