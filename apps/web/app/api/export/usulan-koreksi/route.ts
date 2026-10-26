import ExcelJS from "exceljs";
import { getViewer } from "@/lib/session";
import { loadParameters, paramNumber, viewerClient } from "@/lib/data";
import { computeReconstruction } from "@/lib/recon";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!viewer || !["accounting", "admin"].includes(viewer.role)) {
    return new Response("Tidak berwenang", { status: 403 });
  }
  const url = new URL(request.url);
  const target = url.searchParams.get("target") ?? "2026-06-30";
  const t0 = url.searchParams.get("t0") ?? "2026-07-01";
  const client = await viewerClient(viewer);
  const params = await loadParameters(client, t0);
  const hpp = String(paramNumber(params, "hpp_per_kg", 17419));
  const bookDefault = String(
    paramNumber(params, "tb_egg_whole_rp", 383582877) + paramNumber(params, "tb_egg_broken_rp", 6209446),
  );
  const book = url.searchParams.get("book") ?? bookDefault;

  const result = await computeReconstruction(client, target, t0, book, hpp);
  if ("error" in result) return new Response(result.error, { status: 400 });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Usulan Koreksi");
  sheet.mergeCells("A1:F1");
  sheet.getCell("A1").value = `USULAN KOREKSI POSISI TELUR per ${target}`;
  sheet.getCell("A1").font = { bold: true, size: 14 };
  sheet.getCell("A2").value = `Rekonstruksi dari opname T0 ${t0} · referensi RS-05 · HPP sementara Rp ${hpp}/kg`;
  sheet.getCell("A2").font = { italic: true, size: 9 };

  const header = sheet.addRow(["Kode", "Grade", "Kg hasil rekonstruksi", "HPP sementara", "Nilai Rp", "Selisih vs TB (Rp)"]);
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9D59A" } };
  });

  for (const row of result.rows) {
    const value = Number(row.closing) * Number(hpp);
    sheet.addRow([row.gradeCode, row.gradeCode, Number(row.closing), Number(hpp), value, null]);
  }
  const totalValue = Number(result.totalValueRp);
  sheet.addRow(["", "Total", Number(result.totalClosingKg), null, totalValue, Number(result.diffRp)]);
  sheet.addRow([]);
  sheet.addRow(["Nilai buku (TB)", null, null, null, Number(book), null]);
  if (result.hasMissing) {
    sheet.addRow([
      "Estimasi",
      `Hari tanpa data: ${result.missingDays.join(", ")}`,
      null,
      null,
      null,
      `Batas bawah ${result.lowerKg} kg s.d. batas atas ${result.upperKg} kg`,
    ]);
  }

  sheet.addRow([]);
  const entryHeader = sheet.addRow(["Akun", "Memo", "Debit (Rp)", "Kredit (Rp)"]);
  entryHeader.font = { bold: true };
  for (const entry of result.proposal.entries) {
    sheet.addRow([entry.account, entry.memo, Number(entry.debit), Number(entry.credit)]);
  }
  const balanced = sheet.addRow([
    "Total Dr/Cr",
    result.proposal.balanced ? "Seimbang" : "TIDAK SEIMBANG",
    Number(result.proposal.totalDebit),
    Number(result.proposal.totalCredit),
  ]);
  balanced.font = { bold: true };

  sheet.getColumn(1).width = 12;
  sheet.getColumn(2).width = 28;
  sheet.getColumn(3).width = 20;
  sheet.getColumn(4).width = 18;
  sheet.getColumn(5).width = 18;
  sheet.getColumn(6).width = 22;

  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(new Uint8Array(buffer as ArrayBuffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="Usulan-Koreksi-${target}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
