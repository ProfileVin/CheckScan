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
                .Select(f => new FundraiserSummaryDto(
                    f.Id,
                    f.Name,
                    f.Checks.Sum(c => (decimal?)c.Amount) ?? 0m,
                    f.Checks.Count,
                    f.Checks.Max(c => (DateTime?)c.CheckDate)))
                .ToListAsync();
            return Results.Ok(fundraisers);
        });

        app.MapPost("/fundraisers", async (CreateFundraiserRequest request, CheckScanDbContext db) =>
        {
            var fundraiser = new Fundraiser { Name = request.Name };
            db.Fundraisers.Add(fundraiser);
            await db.SaveChangesAsync();
            return Results.Ok(new FundraiserSummaryDto(fundraiser.Id, fundraiser.Name, 0m, 0, null));
        });

        app.MapGet("/fundraisers/{id:int}", async (int id, CheckScanDbContext db) =>
        {
            var fundraiser = await db.Fundraisers
                .Include(f => f.Checks)
                .FirstOrDefaultAsync(f => f.Id == id);

            if (fundraiser is null) return Results.NotFound();

            var checks = fundraiser.Checks
                .OrderByDescending(c => c.CreatedAt)
                .Select(c => new CheckHistoryDto(c.Id, c.CheckDate, c.CreatedAt, c.Amount, c.Bank, c.Status))
                .ToList();

            return Results.Ok(new FundraiserDetailDto(fundraiser.Id, fundraiser.Name, checks));
        });
    }

    public record CreateFundraiserRequest(string Name);
    public record FundraiserSummaryDto(int Id, string Name, decimal Total, int CheckCount, DateTime? LastDonation);
    public record CheckHistoryDto(int Id, DateTime CheckDate, DateTime CreatedAt, decimal Amount, string Bank, string Status);
    public record FundraiserDetailDto(int Id, string Name, List<CheckHistoryDto> Checks);
}
