import Link from "next/link";
import { requireRole } from "@/lib/session";
import { loadParameters, paramNumber, viewerClient } from "@/lib/data";
import { computeReconstruction, reconstructionSettings } from "@/lib/recon";
import { todayJakarta } from "@winata/db";
import { fmtDate, fmtKg, fmtRp, fmtRpJt, fmtPct } from "@/lib/format";
import { Card, PageHead, Banner, Metric } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { EstimateTag, StatusChip } from "@/components/ui/StatusChip";

export const dynamic = "force-dynamic";

export default async function RekonstruksiPage({
  searchParams,
}: {
  searchParams: Promise<{ target?: string; t0?: string; book?: string }>;
}) {
  const viewer = await requireRole(["accounting", "admin"]);
  const query = await searchParams;
  const client = await viewerClient(viewer);
  const today = todayJakarta();
  const params = await loadParameters(client, today);
  const settings = reconstructionSettings(params);
  const hpp = settings.hppPerKg;
  const defaultTarget = String(params.get("reconstruction_target_date") ?? "2026-06-30").replace(/"/g, "");
  const bookDefault = settings.bookValueRp;
  // Q-21: nilai buku default (jumlah dua akun TB) menunggu konfirmasi pemilik.
  const bookUnconfirmed = paramNumber(params, "tb_total_rp", 389792323) === 389792323;

  const target = /^\d{4}-\d{2}-\d{2}$/.test(query.target ?? "") ? query.target! : defaultTarget;
  const t0 = /^\d{4}-\d{2}-\d{2}$/.test(query.t0 ?? "") ? query.t0! : "2026-07-01";
  const book = query.book ?? String(bookDefault);

  const result = await computeReconstruction(client, target, t0, book, String(hpp), settings);

  return (
    <>
      <PageHead
        title="Rekonstruksi posisi"
        sub={`${fmtDate(target)} dari opname T0 ${fmtDate(t0)} · HPP sementara ${fmtRp(hpp)}/kg`}
        actions={<EstimateTag />}
      />

      <Card title="Parameter" sub="Ubah tanggal target, T0, atau nilai buku">
        <form action="/rekonstruksi" method="get" className="form-grid">
          <div className="field">
            <label htmlFor="target">Tanggal target</label>
            <input id="target" name="target" type="date" className="input" defaultValue={target} />
          </div>
          <div className="field">
            <label htmlFor="t0">Tanggal T0 (opname)</label>
            <input id="t0" name="t0" type="date" className="input" defaultValue={t0} />
          </div>
          <div className="field">
            <label htmlFor="book">Nilai buku TB (Rp)</label>
            <input id="book" name="book" className="input" defaultValue={book} />
          </div>
          <div className="row" style={{ alignSelf: "end" }}>
            <button type="submit" className="btn btn-primary">Hitung ulang</button>
          </div>
        </form>
      </Card>

      {"error" in result ? (
        <Banner tone="fail">{result.error}</Banner>
      ) : (
        <>
          <div className="grid grid-4">
            <Card title="Closing hasil rekonstruksi">
              <Metric value={fmtKg(result.totalClosingKg, 0)} unit="kg" sub={`${result.periodDays} hari data`} />
            </Card>
            <Card title="Nilai (HPP sementara)">
              <Metric value={fmtRpJt(result.totalValueRp)} sub={<EstimateTag />} />
            </Card>
            <Card title="Nilai buku (TB)">
              <Metric
                value={fmtRpJt(result.bookValueRp)}
                sub={
                  bookUnconfirmed ? (
                    <StatusChip
                      status="warn"
                      label="Nilai buku belum dikonfirmasi"
                      title="Isi parameter tb_total_rp di Admin → Parameter setelah dikonfirmasi pemilik."
                    />
                  ) : (
                    "Telur utuh + pecah"
                  )
                }
              />
            </Card>
            <Card title="Selisih vs TB">
              <Metric
                value={fmtRpJt(result.diffRp)}
                negative={Number(result.diffRp) < 0}
                sub={`${fmtPct(result.diffPct)} dari nilai buku`}
              />
            </Card>
          </div>

          {result.hasMissing ? (
            <Banner tone="warn">
              <strong>Estimasi.</strong> Ada {result.missingDays.length} hari tanpa data recording:{" "}
              {result.missingDays.slice(0, 8).map((day) => fmtDate(day)).join(", ")}
              {result.missingDays.length > 8 ? ", …" : ""}. Batas bawah {fmtKg(result.lowerKg, 0)} kg s.d. batas atas{" "}
              {fmtKg(result.upperKg, 0)} kg.
            </Banner>
          ) : null}

          <Card title="Per grade" sub="closing(T0) − produksi + keluar + susut ± koreksi">
            <DataTable
              columns={[
                { key: "grade", label: "Grade" },
                { key: "t0", label: "Closing T0", numeric: true },
                { key: "production", label: "− Produksi", numeric: true },
                { key: "outbound", label: "+ Keluar", numeric: true },
                { key: "shrinkage", label: "+ Susut", numeric: true },
                { key: "correction", label: "− Koreksi", numeric: true },
                { key: "closing", label: "Closing target", numeric: true },
                { key: "value", label: "Nilai Rp", numeric: true },
              ]}
              rows={result.rows.map((row) => ({
                __key: row.gradeId,
                grade: row.gradeCode,
                t0: fmtKg(row.t0Closing, 1),
                production: fmtKg(row.production, 1),
                outbound: fmtKg(row.outbound, 1),
                shrinkage: fmtKg(row.shrinkage, 1),
                correction: fmtKg(row.correction, 1),
                closing: (
                  <span>
                    {fmtKg(row.closing, 1)}
                    {row.estimated ? <span className="small muted"> (est. {fmtKg(row.lowerKg, 0)}–{fmtKg(row.upperKg, 0)})</span> : null}
                  </span>
                ),
                value: fmtRp(Number(row.closing) * hpp),
              }))}
              footer={
                <>
                  <tr>
                    <td>Total</td>
                    <td colSpan={5} />
                    <td className="num">{fmtKg(result.totalClosingKg, 1)}</td>
                    <td className="num">{fmtRp(result.totalValueRp)}</td>
                  </tr>
                  {result.hasMissing ? (
                    <>
                      <tr>
                        <td colSpan={6}>
                          Batas bawah (estimasi){" "}
                          <StatusChip
                            status="estimate"
                            label="Estimasi"
                            title="Closing dikurangi rata-rata produksi harian 5 hari terakhir Juni × jumlah hari tanpa data."
                          />
                        </td>
                        <td className="num">{fmtKg(result.lowerKg, 1)}</td>
                        <td />
                      </tr>
                      <tr>
                        <td colSpan={6}>
                          Batas atas (estimasi){" "}
                          <StatusChip
                            status="estimate"
                            label="Estimasi"
                            title="Closing ditambah rata-rata keluar harian yang tercatat Juli–T0 × jumlah hari tanpa data."
                          />
                        </td>
                        <td className="num">{fmtKg(result.upperKg, 1)}</td>
                        <td />
                      </tr>
                    </>
                  ) : null}
                </>
              }
            />
          </Card>

          <Card title="Draft Usulan Koreksi (Dr/Cr)" sub={`Referensi RS-05 · ${result.proposal.balanced ? "seimbang" : "tidak seimbang"}`}>
            {!result.proposal.accountsConfirmed ? (
              <div className="row" style={{ marginBottom: 8 }}>
                <StatusChip
                  status="warn"
                  label="Akun belum dikonfirmasi"
                  title="Isi parameter coa_inventory_egg dan coa_inventory_variance di Admin → Parameter."
                />
              </div>
            ) : null}
            <DataTable
              columns={[
                { key: "account", label: "Akun" },
                { key: "memo", label: "Memo" },
                { key: "debit", label: "Debit Rp", numeric: true },
                { key: "credit", label: "Kredit Rp", numeric: true },
              ]}
              rows={result.proposal.entries.map((entry, index) => ({
                __key: `${entry.account}-${index}`,
                account: entry.account,
                memo: entry.memo,
                debit: fmtRp(entry.debit),
                credit: fmtRp(entry.credit),
              }))}
              footer={
                <tr>
                  <td colSpan={2}>Total</td>
                  <td className="num">{fmtRp(result.proposal.totalDebit)}</td>
                  <td className="num">{fmtRp(result.proposal.totalCredit)}</td>
                </tr>
              }
            />
            <div className="row" style={{ marginTop: 12 }}>
              <a
                className="btn btn-primary"
                href={`/api/export/usulan-koreksi?target=${target}&t0=${t0}&book=${encodeURIComponent(book)}`}
              >
                Unduh draft Usulan Koreksi (XLSX)
              </a>
              <Link className="btn" href={`/rekon?tab=koreksi`}>
                Buat koreksi di Rekon
              </Link>
            </div>
          </Card>

          <Banner tone="info">
            Rekonstruksi hanya membalik arus Juli–T0 dari opname T0. Bila recording tidak lengkap, hasil berlabel
            estimasi dengan batas atas/bawah; jangan dipakai sebagai angka final tanpa penjelasan.
          </Banner>
        </>
      )}
    </>
  );
}
