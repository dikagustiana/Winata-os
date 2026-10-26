import ExcelJS from "exceljs";
import { todayJakarta } from "@winata/db";
import { getViewer } from "@/lib/session";
import { viewerClient } from "@/lib/data";
import { buildBs04aFromDb } from "@/lib/recon";
import { paramNumber, loadParameters } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!viewer || !["accounting", "admin"].includes(viewer.role)) {
    return new Response("Tidak berwenang", { status: 403 });
  }
  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? todayJakarta();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Response("Tanggal tidak sah", { status: 400 });

  const client = await viewerClient(viewer);
  const params = await loadParameters(client, date);
  const hpp = String(paramNumber(params, "hpp_per_kg", 17419));
  const rows = await buildBs04aFromDb(client, date, hpp);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Winata Egg Position";
  const sheet = workbook.addWorksheet("BS 04A Persediaan");
  sheet.mergeCells("A1:L1");
  sheet.getCell("A1").value = `BS 04A PERSEDIAAN TELUR — ${date}`;
  sheet.getCell("A1").font = { bold: true, size: 14 };
  sheet.getCell("A2").value = "HPP sementara (belum costing flok). Angka kg 3 desimal.";
  sheet.getCell("A2").font = { italic: true, size: 9, color: { argb: "FF6B4510" } };

  const header = [
    "No",
    "Kode",
    "Grade",
    "Kg",
    "Butir",
    "HPP sementara /kg",
    "Nilai Rp",
    "0–3 hari (kg)",
    "4–7 hari (kg)",
    "8–14 hari (kg)",
    ">14 hari (kg)",
    "Hari stok",
  ];
  const headerRow = sheet.addRow(header);
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7F0E8" } };
    cell.border = { bottom: { style: "thin", color: { argb: "FFD9DDD6" } } };
  });

  let totalKg = 0;
  let totalRp = 0;
  rows.forEach((row, index) => {
    const kg = Number(row.kg);
    const rp = Number(row.valueRp);
    totalKg += kg;
    totalRp += rp;
    sheet.addRow([
      index + 1,
      row.gradeCode,
      row.gradeName,
      kg,
      row.eggs ? Number(row.eggs) : null,
      Number(row.hppPerKg),
      rp,
      Number(row.ageB1),
      Number(row.ageB2),
      Number(row.ageB3),
      Number(row.ageB4),
      row.daysOfStock ? Number(row.daysOfStock) : null,
    ]);
  });

  const totalRow = sheet.addRow(["", "", "Total", totalKg, null, null, totalRp, null, null, null, null, null]);
  totalRow.font = { bold: true };

  sheet.getColumn(1).width = 6;
  sheet.getColumn(2).width = 9;
  sheet.getColumn(3).width = 20;
  sheet.getColumn(4).width = 12;
  sheet.getColumn(5).width = 12;
  sheet.getColumn(6).width = 18;
  sheet.getColumn(7).width = 16;
  for (let column = 8; column <= 11; column += 1) sheet.getColumn(column).width = 13;
  sheet.getColumn(12).width = 11;
  for (let row = 4; row <= 3 + rows.length; row += 1) {
    sheet.getCell(`D${row}`).numFmt = "#,##0.000";
    sheet.getCell(`F${row}`).numFmt = "#,##0";
    sheet.getCell(`G${row}`).numFmt = "#,##0";
    for (let column = 8; column <= 11; column += 1) {
      sheet.getCell(row, column).numFmt = "#,##0.000";
    }
  }
  sheet.getCell(`D${4 + rows.length}`).numFmt = "#,##0.000";
  sheet.getCell(`G${4 + rows.length}`).numFmt = "#,##0";

  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(new Uint8Array(buffer as ArrayBuffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="BS-04A-${date}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
