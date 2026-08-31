using CheckScan.Api.AI;
using CheckScan.Api.Data;
using CheckScan.Api.Data.Entities;
using CheckScan.Api.Storage;

namespace CheckScan.Api.Endpoints;

public static class CheckEndpoints
{
    public static void MapCheckEndpoints(this WebApplication app)
    {
        app.MapPost("/checks", async (SaveCheckRequest request, CheckScanDbContext db, ICheckImageStore imageStore) =>
        {
            var check = new Check
            {
                FundraiserId = request.FundraiserId,
                BatchId = request.BatchId,
                Amount = request.Amount,
                LegalAmount = request.LegalAmount,
                Bank = request.Bank,
                CheckDate = request.CheckDate,
                Memo = request.Memo,
                RoutingNumber = request.RoutingNumber,
                AccountNumber = request.AccountNumber,
                DonorName = request.DonorName,
                CheckNumber = request.CheckNumber,
                ExtractionConfidenceJson = request.ConfidenceJson,
                Status = string.IsNullOrWhiteSpace(request.Status) ? "Verified" : request.Status,
                // Local Processed-folder path, or an Azure Blob name when ImageStorage:Provider = AzureBlob.
                ImagePath = await imageStore.PutConfirmedAsync(request.ImagePath),
                CreatedAt = DateTime.UtcNow,
            };
            db.Checks.Add(check);
            await db.SaveChangesAsync();
            return Results.Ok(new { id = check.Id });
        });

        // Runs the Anthropic vision extraction server-side (key from Anthropic:ApiKey config).
        // imagePath is a local path on this machine - the API is loopback-only next to the app.
        app.MapPost("/checks/extract", async (ExtractCheckRequest request, CheckExtractionService extractor) =>
        {
            if (string.IsNullOrWhiteSpace(request.ImagePath))
            {
                return Results.BadRequest(new { error = "imagePath is required." });
            }

            try
            {
                var json = await extractor.ExtractAsync(request.ImagePath);
                return Results.Content(json, "application/json");
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });
    }

    public record ExtractCheckRequest(string ImagePath);

    public record SaveCheckRequest(
        int FundraiserId,
        int BatchId,
        decimal Amount,
        string Bank,
        DateTime CheckDate,
        string? RoutingNumber,
        string? AccountNumber,
        string? DonorName,
        string? CheckNumber,
        string ImagePath,
        string? ConfidenceJson,
        string? LegalAmount = null,
        string? Memo = null,
        string? Status = null);
}
