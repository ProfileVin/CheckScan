using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace CheckScan.Api.AI;

/// <summary>
/// Sends a scanned check image to the Anthropic vision API and returns the extracted fields
/// (amount, date, bank, routing/account numbers, donor name, check number) plus a per-field
/// confidence map, as raw JSON in the exact shape the desktop UI's check card expects.
///
/// The API key comes from configuration key <c>Anthropic:ApiKey</c> (seeded from
/// appsettings.Development.json in dev). Ported from the former Electron-side
/// electron/ai/extractCheck.js so the desktop app no longer needs its own key.
/// </summary>
public sealed class CheckExtractionService
{
    // Defaults used when the matching Anthropic:* configuration key is absent.
    private const string DefaultModel = "claude-opus-5"; // vision-capable
    private const string DefaultEndpoint = "https://api.anthropic.com/v1/messages";
    private const string DefaultApiVersion = "2023-06-01";
    // Ceiling used when Anthropic:MaxTokens is 0 / blank / unset. Far above any extraction
    // response (JSON + the model's reasoning), so nothing gets truncated; still a runaway guard.
    private const int DefaultMaxTokens = 16000;

    // Override wholesale at runtime with Anthropic:ExtractionPrompt in appsettings (empty = use this).
    private const string DefaultExtractionPrompt =
        "This is a check, though not necessarily a standard bank check - it's mostly similar to one. " +
        "The amount can be handwritten. The date can be handwritten. " +
        "\"amount\" is the numeric (courtesy) amount as a number; \"legalAmount\" is the written / spelled-out " +
        "amount on the words line, verbatim, e.g. \"Five hundred and 00/100\". " +
        "\"memo\" is any free text on the memo / \"for\" line (empty string if blank). " +
        "The bottom right has a barcode - ignore it. Below the barcode are the routing and account numbers. " +
        "The routing number may include one or more MICR symbols; exclude those, they are not part of the number. " +
        "Identify the issuing bank from its printed logo or name.\n\n" +
        "Return strict JSON only, no markdown code fences, in exactly this shape:\n" +
        "{\"amount\": number, \"legalAmount\": string, \"date\": \"YYYY-MM-DD\", \"bank\": string, \"memo\": string, \"routingNumber\": string, \"accountNumber\": string, \"donorName\": string, \"checkNumber\": string, \"confidence\": {\"amount\": number, \"legalAmount\": number, \"date\": number, \"bank\": number, \"memo\": number, \"routingNumber\": number, \"accountNumber\": number, \"donorName\": number, \"checkNumber\": number}}\n\n" +
        "Each confidence value is a number from 0 to 1 for how certain you are of that field: " +
        "~0.95+ when clearly legible, ~0.8 when readable with some doubt, ~0.6 or lower when hard to read or guessed. " +
        "If a field cannot be read at all, use null for its value and 0 for its confidence.";

    private static readonly Regex CodeFence =
        new(@"^```(?:json)?\s*([\s\S]*?)\s*```$", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private readonly HttpClient _http;
    private readonly IConfiguration _config;
    private readonly ILogger<CheckExtractionService> _logger;

    public CheckExtractionService(HttpClient http, IConfiguration config, ILogger<CheckExtractionService> logger)
    {
        _http = http;
        _config = config;
        _logger = logger;
    }

    /// <summary>
    /// Reads the check image at <paramref name="imagePath"/> (a local path on this machine - the
    /// API runs loopback-only alongside the desktop app) and returns the model's JSON verbatim.
    /// Throws <see cref="InvalidOperationException"/> / <see cref="FileNotFoundException"/> with a
    /// human-readable message on any failure; the endpoint surfaces that as {"error": message}.
    /// </summary>
    public async Task<string> ExtractAsync(string imagePath, CancellationToken ct = default)
    {
        var apiKey = _config["Anthropic:ApiKey"];
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            throw new InvalidOperationException(
                "Anthropic API key is not set. Add Anthropic:ApiKey to configuration (appsettings.Development.json) before extracting check data.");
        }

        if (!File.Exists(imagePath))
        {
            throw new FileNotFoundException($"Check image not found: {imagePath}", imagePath);
        }

        // All tunable at runtime via appsettings (Anthropic:*) - no rebuild needed, just restart.
        var model = _config["Anthropic:Model"] is { Length: > 0 } m ? m : DefaultModel;
        var endpoint = _config["Anthropic:Endpoint"] is { Length: > 0 } ep ? ep : DefaultEndpoint;
        var apiVersion = _config["Anthropic:ApiVersion"] is { Length: > 0 } v ? v : DefaultApiVersion;
        var maxTokens = int.TryParse(_config["Anthropic:MaxTokens"], out var mt) && mt > 0 ? mt : DefaultMaxTokens;
        var prompt = _config["Anthropic:ExtractionPrompt"] is { Length: > 0 } pr ? pr : DefaultExtractionPrompt;

        var imageBytes = await File.ReadAllBytesAsync(imagePath, ct);
        var imageBase64 = Convert.ToBase64String(imageBytes);
        var mediaType = MediaTypeFor(imagePath);
        _logger.LogInformation("Extracting check data from {ImagePath} ({Bytes} bytes) via {Model}.",
            imagePath, imageBytes.Length, model);

        var payload = new
        {
            model,
            // Generous headroom: claude-opus-5 spends output tokens on internal reasoning before
            // the visible JSON, so a tight limit truncates the answer mid-string.
            max_tokens = maxTokens,
            messages = new[]
            {
                new
                {
                    role = "user",
                    content = new object[]
                    {
                        new { type = "image", source = new { type = "base64", media_type = mediaType, data = imageBase64 } },
                        new { type = "text", text = prompt },
                    },
                },
            },
        };

        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint)
        {
            Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json"),
        };
        request.Headers.Add("x-api-key", apiKey);
        request.Headers.Add("anthropic-version", apiVersion);

        using var response = await _http.SendAsync(request, ct);
        var body = await response.Content.ReadAsStringAsync(ct);

        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"Anthropic extraction failed ({(int)response.StatusCode}): {body}");
        }

        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;
        var stopReason = root.TryGetProperty("stop_reason", out var sr) ? sr.GetString() : null;

        JsonElement textBlock = default;
        if (root.TryGetProperty("content", out var content) && content.ValueKind == JsonValueKind.Array)
        {
            textBlock = content.EnumerateArray().FirstOrDefault(block =>
                block.TryGetProperty("type", out var t) && t.GetString() == "text");
        }

        if (textBlock.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidOperationException(
                $"Anthropic response contained no text content. stop_reason={stopReason ?? "(none)"}.");
        }

        if (stopReason == "max_tokens")
        {
            throw new InvalidOperationException(
                "Anthropic response was cut off before the JSON finished (stop_reason=max_tokens). Raise max_tokens in CheckExtractionService.");
        }

        var raw = StripCodeFences(textBlock.GetProperty("text").GetString() ?? string.Empty);
        try
        {
            using var _ = JsonDocument.Parse(raw); // validate the shape before handing it back
            return raw;
        }
        catch (JsonException ex)
        {
            var preview = raw.Length > 500 ? raw[..500] : raw;
            throw new InvalidOperationException(
                $"Could not parse extraction JSON ({ex.Message}). Model returned: {preview}");
        }
    }

    private static string MediaTypeFor(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".png" => "image/png",
        ".gif" => "image/gif",
        ".webp" => "image/webp",
        _ => "image/jpeg",
    };

    private static string StripCodeFences(string text)
    {
        var trimmed = text.Trim();
        var match = CodeFence.Match(trimmed);
        return match.Success ? match.Groups[1].Value : trimmed;
    }
}
