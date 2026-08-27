using CheckScan.Api.Data;
using CheckScan.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace CheckScan.Api.Endpoints;

public static class FundraiserEndpoints
{
    public static void MapFundraiserEndpoints(this WebApplication app)
    {
        app.MapGet("/fundraisers", async (CheckScanDbContext db) =>
        {
            var fundraisers = await db.Fundraisers
                .Select(f => new FundraiserSummaryDto(f.Id, f.Name, f.Checks.Sum(c => (decimal?)c.Amount) ?? 0m))
                .ToListAsync();
            return Results.Ok(fundraisers);
        });

        app.MapPost("/fundraisers", async (CreateFundraiserRequest request, CheckScanDbContext db) =>
        {
            var fundraiser = new Fundraiser { Name = request.Name };
            db.Fundraisers.Add(fundraiser);
            await db.SaveChangesAsync();
            return Results.Ok(new FundraiserSummaryDto(fundraiser.Id, fundraiser.Name, 0m));
        });

        app.MapGet("/fundraisers/{id:int}", async (int id, CheckScanDbContext db) =>
        {
            var fundraiser = await db.Fundraisers
                .Include(f => f.Checks)
                .FirstOrDefaultAsync(f => f.Id == id);

            if (fundraiser is null) return Results.NotFound();

            var checks = fundraiser.Checks
                .OrderByDescending(c => c.CheckDate)
                .Select(c => new CheckHistoryDto(c.Id, c.CheckDate, c.Amount, c.Bank))
                .ToList();

            return Results.Ok(new FundraiserDetailDto(fundraiser.Id, fundraiser.Name, checks));
        });
    }

    public record CreateFundraiserRequest(string Name);
    public record FundraiserSummaryDto(int Id, string Name, decimal Total);
    public record CheckHistoryDto(int Id, DateTime CheckDate, decimal Amount, string Bank);
    public record FundraiserDetailDto(int Id, string Name, List<CheckHistoryDto> Checks);
}
