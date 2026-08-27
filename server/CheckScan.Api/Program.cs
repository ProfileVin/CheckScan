using CheckScan.Api.Data;
using CheckScan.Api.Endpoints;
using CheckScan.Api.Storage;
using CheckScan.Api.Twain;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// Bind to 127.0.0.1 on an OS-assigned free port. Never 0.0.0.0 - this handles check images
// and must not be reachable from other machines on the network.
builder.WebHost.ConfigureKestrel(options =>
{
    options.Listen(System.Net.IPAddress.Loopback, 0, listenOptions =>
    {
        listenOptions.Protocols = HttpProtocols.Http1AndHttp2;
    });
});

// Holds the Azure SQL + Azure Blob connection strings DPAPI-encrypted on disk (seeded from the
// Electron Settings page), falling back to ConnectionStrings:* config for local dev.
builder.Services.AddSingleton<SecretStore>();

builder.Services.AddDbContext<CheckScanDbContext>((sp, options) =>
{
    var connectionString = sp.GetRequiredService<SecretStore>().GetDb();
    if (!string.IsNullOrWhiteSpace(connectionString))
    {
        options.UseSqlServer(connectionString);
    }
    else
    {
        // Not configured yet - register the provider so the context can still be constructed;
        // the startup Migrate() below is already wrapped to fail soft, and save-a-check calls
        // surface a clear error until a connection string is entered in Settings.
        options.UseSqlServer();
    }
});

builder.Services.AddSingleton<TwainThread>();
builder.Services.AddSingleton<ScanBroadcaster>();
builder.Services.AddSingleton<ImageStorageOptions>();
builder.Services.AddSingleton<TwainScanService>();

// Where a confirmed check's image lands: local disk by default, or Azure Blob Storage when
// ImageStorage:Provider = AzureBlob (AzureBlobCheckImageStore falls back to local on any failure).
builder.Services.AddScoped<LocalCheckImageStore>();
var imageProvider = builder.Configuration["ImageStorage:Provider"] ?? "Local";
if (imageProvider.Equals("AzureBlob", StringComparison.OrdinalIgnoreCase))
{
    builder.Services.AddScoped<ICheckImageStore, AzureBlobCheckImageStore>();
}
else
{
    builder.Services.AddScoped<ICheckImageStore>(sp => sp.GetRequiredService<LocalCheckImageStore>());
}

var app = builder.Build();

app.UseWebSockets();

app.MapScannerEndpoints();
app.MapScanEndpoints();
app.MapBatchEndpoints();
app.MapFundraiserEndpoints();
app.MapCheckEndpoints();
app.MapReportEndpoints();
app.MapSettingsEndpoints();

var twainThread = app.Services.GetRequiredService<TwainThread>();
twainThread.Start();
await twainThread.WaitUntilReadyAsync();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<CheckScanDbContext>();
    try
    {
        db.Database.Migrate();
    }
    catch (Exception ex)
    {
        // Don't let an unreachable/misconfigured Azure SQL server take down scanning -
        // scanner endpoints work independently of the DB. Save-to-database calls will
        // fail until ConnectionStrings:DefaultConnection is fixed.
        app.Logger.LogWarning(ex, "Database migration failed - check ConnectionStrings:DefaultConnection.");
    }
}

app.Lifetime.ApplicationStarted.Register(() =>
{
    var addressFeature = app.Services.GetRequiredService<Microsoft.AspNetCore.Hosting.Server.IServer>()
        .Features.Get<Microsoft.AspNetCore.Hosting.Server.Features.IServerAddressesFeature>();
    var address = addressFeature?.Addresses.FirstOrDefault();
    if (address is not null)
    {
        var port = new Uri(address).Port;
        Console.WriteLine($"PORT:{port}");
    }
});

app.Run();
