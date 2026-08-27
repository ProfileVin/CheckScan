namespace CheckScan.Api.Data.Entities;

/// <summary>Single-row table holding the user's chosen default TWAIN source.</summary>
public class ScannerPreference
{
    public int Id { get; set; }
    public required string SourceId { get; set; }
    public required string SourceName { get; set; }
}
