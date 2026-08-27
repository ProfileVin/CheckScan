using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;

namespace CheckScan.Api.Data;

/// <summary>Lets `dotnet ef migrations add` build a DbContext without running the full app.</summary>
public class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<CheckScanDbContext>
{
    public CheckScanDbContext CreateDbContext(string[] args)
    {
        var config = new ConfigurationBuilder()
            .SetBasePath(Directory.GetCurrentDirectory())
            .AddJsonFile("appsettings.json", optional: true)
            .AddJsonFile("appsettings.Development.json", optional: true)
            .Build();

        // Design-time only (`dotnet ef migrations` / `database update`). The running app never uses
        // this - it resolves the connection string from the DPAPI-encrypted SecretStore instead.
        var connectionString = config.GetConnectionString("DefaultConnection")
            ?? "Server=(localdb)\\mssqllocaldb;Database=CheckScan;Trusted_Connection=True;";

        var optionsBuilder = new DbContextOptionsBuilder<CheckScanDbContext>();
        optionsBuilder.UseSqlServer(connectionString);

        return new CheckScanDbContext(optionsBuilder.Options);
    }
}
