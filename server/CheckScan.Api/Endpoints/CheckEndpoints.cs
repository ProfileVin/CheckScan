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
                Bank = request.Bank,
                CheckDate = request.CheckDate,
                RoutingNumber = request.RoutingNumber,
                AccountNumber = request.AccountNumber,
                DonorName = request.DonorName,
                CheckNumber = request.CheckNumber,
                ExtractionConfidenceJson = request.ConfidenceJson,
                // Local Processed-folder path, or an Azure Blob name when ImageStorage:Provider = AzureBlob.
                ImagePath = await imageStore.PutConfirmedAsync(request.ImagePath),
                CreatedAt = DateTime.UtcNow,
            };
            db.Checks.Add(check);
            await db.SaveChangesAsync();
            return Results.Ok(new { id = check.Id });
        });
    }

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
        string? ConfidenceJson);
}
