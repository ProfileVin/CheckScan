using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CheckScan.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddLegalAmountAndMemo : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "LegalAmount",
                table: "Checks",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Memo",
                table: "Checks",
                type: "nvarchar(max)",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "LegalAmount",
                table: "Checks");

            migrationBuilder.DropColumn(
                name: "Memo",
                table: "Checks");
        }
    }
}
