namespace CheckScan.Api.Data.Entities;

public class Check
{
    public int Id { get; set; }
    public int FundraiserId { get; set; }
    public Fundraiser Fundraiser { get; set; } = null!;
    public int BatchId { get; set; }
    public Batch Batch { get; set; } = null!;
    public decimal Amount { get; set; }
    public required string Bank { get; set; }
    public DateTime CheckDate { get; set; }
    public string? RoutingNumber { get; set; }
    public string? AccountNumber { get; set; }
    public string? DonorName { get; set; }
    public string? CheckNumber { get; set; }
    /// <summary>JSON map of field name to confidence (0-1), e.g. {"amount":0.9,"date":0.7}.</summary>
    public string? ExtractionConfidenceJson { get; set; }
    public required string ImagePath { get; set; }
    public DateTime CreatedAt { get; set; }
}
