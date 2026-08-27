using CheckScan.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace CheckScan.Api.Data;

public class CheckScanDbContext(DbContextOptions<CheckScanDbContext> options) : DbContext(options)
{
    public DbSet<Fundraiser> Fundraisers => Set<Fundraiser>();
    public DbSet<Batch> Batches => Set<Batch>();
    public DbSet<Check> Checks => Set<Check>();
    public DbSet<ScannerPreference> ScannerPreferences => Set<ScannerPreference>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Check>()
            .Property(c => c.Amount)
            .HasPrecision(18, 2);
    }
}
