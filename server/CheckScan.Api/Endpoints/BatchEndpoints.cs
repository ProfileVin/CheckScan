using CheckScan.Api.Data;
using CheckScan.Api.Data.Entities;

namespace CheckScan.Api.Endpoints;

public static class BatchEndpoints
{
    public static void MapBatchEndpoints(this WebApplication app)
    {
        app.MapPost("/batches", async (CreateBatchRequest? request, CheckScanDbContext db) =>
        {
            var batch = new Batch
            {
                CreatedAt = DateTime.UtcNow,
                Label = request?.Label,
            };
            db.Batches.Add(batch);
            await db.SaveChangesAsync();
            return Results.Ok(new { id = batch.Id });
        });
    }

    public record CreateBatchRequest(string? Label);
}
