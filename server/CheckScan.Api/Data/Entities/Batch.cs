namespace CheckScan.Api.Data.Entities;

public class Batch
{
    public int Id { get; set; }
    public DateTime CreatedAt { get; set; }
    public string? Label { get; set; }
    public List<Check> Checks { get; set; } = new();
}
