using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CheckScan.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddExtractionFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AccountNumber",
                table: "Checks",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CheckNumber",
                table: "Checks",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DonorName",
                table: "Checks",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ExtractionConfidenceJson",
                table: "Checks",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RoutingNumber",
                table: "Checks",
                type: "nvarchar(max)",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AccountNumber",
                table: "Checks");

            migrationBuilder.DropColumn(
                name: "CheckNumber",
                table: "Checks");

            migrationBuilder.DropColumn(
                name: "DonorName",
                table: "Checks");

            migrationBuilder.DropColumn(
                name: "ExtractionConfidenceJson",
                table: "Checks");

            migrationBuilder.DropColumn(
                name: "RoutingNumber",
                table: "Checks");
        }
    }
}
