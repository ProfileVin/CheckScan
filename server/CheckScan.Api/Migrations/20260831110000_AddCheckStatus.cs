using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CheckScan.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddCheckStatus : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Status",
                table: "Checks",
                type: "nvarchar(max)",
                nullable: false,
                defaultValue: "Verified");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Status",
                table: "Checks");
        }
    }
}
