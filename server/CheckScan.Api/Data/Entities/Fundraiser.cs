namespace CheckScan.Api.Data.Entities;

public class Fundraiser
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public List<Check> Checks { get; set; } = new();
}
