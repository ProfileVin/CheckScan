using System.Text;
using CheckScan.Api.Data;
using CheckScan.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace CheckScan.Api.Endpoints;

public static class ReportEndpoints
{
    public static void MapReportEndpoints(this WebApplication app)
    {
        app.MapGet("/reports/summary", async (string groupBy, DateTime? from, DateTime? to, CheckScanDbContext db) =>
        {
            var rows = await BuildSummaryAsync(groupBy, from, to, db);
            return Results.Ok(rows);
        });

        app.MapGet("/reports/transactions", async (CheckScanDbContext db) =>
        {
            var rows = await db.Checks
                .OrderByDescending(c => c.CheckDate)
                .ThenByDescending(c => c.Id)
                .Select(c => new TransactionRowDto(
                    c.Id,
                    c.CheckDate,
                    c.Fundraiser.Name,
                    c.Bank,
                    c.Amount,
                    c.Status))
                .ToListAsync();

            return Results.Ok(rows);
        });

        app.MapGet("/reports/export", async (string groupBy, DateTime? from, DateTime? to, CheckScanDbContext db) =>
        {
            var rows = await BuildSummaryAsync(groupBy, from, to, db);

            var csv = new StringBuilder();
            csv.AppendLine("Group,Count,Total");
            foreach (var row in rows)
            {
                csv.AppendLine($"\"{row.Group.Replace("\"", "\"\"")}\",{row.Count},{row.Total}");
            }

            return Results.Text(csv.ToString(), "text/csv");
        });
    }

    private static async Task<List<SummaryRowDto>> BuildSummaryAsync(string groupBy, DateTime? from, DateTime? to, CheckScanDbContext db)
    {
        IQueryable<Check> query = db.Checks
            .Include(c => c.Fundraiser);

        if (from is not null) query = query.Where(c => c.CheckDate >= from);
        if (to is not null) query = query.Where(c => c.CheckDate <= to);

        return groupBy switch
        {
            "fundraiser" => await query
                .GroupBy(c => c.Fundraiser.Name)
                .Select(g => new SummaryRowDto(g.Key, g.Count(), g.Sum(c => c.Amount)))
                .ToListAsync(),

            "bank" => await query
                .GroupBy(c => c.Bank)
                .Select(g => new SummaryRowDto(g.Key, g.Count(), g.Sum(c => c.Amount)))
                .ToListAsync(),

            "date" => (await query
                .Select(c => new { c.CheckDate, c.Amount })
                .ToListAsync())
                .GroupBy(c => c.CheckDate.Date)
                .Select(g => new SummaryRowDto(g.Key.ToString("yyyy-MM-dd"), g.Count(), g.Sum(c => c.Amount)))
                .OrderBy(r => r.Group)
                .ToList(),

            _ => throw new ArgumentException($"Unknown groupBy '{groupBy}'. Use fundraiser, bank, or date."),
        };
    }

    public record SummaryRowDto(string Group, int Count, decimal Total);
    public record TransactionRowDto(int Id, DateTime Date, string Fundraiser, string Bank, decimal Amount, string Status);
}
