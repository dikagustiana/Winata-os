import Link from "next/link";
import { addDays, startOfWeek } from "@winata/engine";
import { todayJakarta } from "@winata/db";
import type {
  CashBalanceRow,
  CashPlanRow,
  DayStatusRow,
  GradeRow,
  LocationRow,

  CorrectionRow,
  AccurateUploadRow,
  ItemMapRow,
} from "@winata/db";
import { requireRole } from "@/lib/session";
import { loadParameters, paramNumber, viewerClient } from "@/lib/data";
import { fmtDate, fmtKg, fmtRp, fmtRpJt } from "@/lib/format";
import { Card, PageHead, Banner, Metric, Empty } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { ActionForm } from "@/components/ui/ActionForm";
import { DateInput, SelectInput, TextInput } from "@/components/ui/Inputs";
import { StatusChip } from "@/components/ui/StatusChip";
import { lockDayAction, createCorrectionAction, approveCorrectionAction, postCorrectionAction, cancelCorrectionAction } from "@/lib/actions/workflow";
import { saveCashBalanceAction, saveCashPlanAction } from "@/lib/actions/plan";
import { importCsvAction, saveItemMapAction, saveReconciliationAction, updateReconItemAction, uploadAccurateAction } from "@/lib/actions/recon";
import { IMPORT_COLUMNS } from "@winata/parsers";
import { loadReconciliationItems, periodRange } from "@/lib/recon";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "kunci", label: "Kunci hari" },
  { key: "koreksi", label: "Koreksi" },
  { key: "accurate", label: "Accurate" },
  { key: "kas", label: "Kas" },
  { key: "import", label: "Impor" },
  { key: "ekspor", label: "Ekspor" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default async function RekonPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; period?: string; edit?: string; batal?: string; koreksi?: string }>;
}) {
  const viewer = await requireRole(["accounting", "admin", "bod"]);
  const query = await searchParams;
  const tab: TabKey = (TABS.find((item) => item.key === query.tab)?.key ?? "kunci") as TabKey;
  const today = todayJakarta();
  const period = /^\d{4}-\d{2}$/.test(query.period ?? "") ? query.period! : today.slice(0, 7);
  const client = await viewerClient(viewer);
  const isAccounting = viewer.role === "accounting" || viewer.role === "admin";

  const locations = ((await client.from("location").select("*").eq("active", true).order("code")).data as LocationRow[]) ?? [];
  const grades = ((await client.from("grade").select("*").eq("active", true).order("sort")).data as GradeRow[]) ?? [];
  const locationById = new Map(locations.map((location) => [location.id, location]));
  const gradeById = new Map(grades.map((grade) => [grade.id, grade]));
  const parameters = await loadParameters(client, today);
  const alertDays = paramNumber(parameters, "days_of_stock_alert", 5);

  const approvedDays = ((await client
    .from("day_status")
    .select("*")
    .eq("status", "approved")
    .is("deleted_at", null)
    .order("date", { ascending: false })
    .limit(40)).data as DayStatusRow[]) ?? [];
  const lockedDays = ((await client
    .from("day_status")
    .select("*")
    .eq("status", "locked")
    .is("deleted_at", null)
    .order("date", { ascending: false })
    .limit(40)).data as DayStatusRow[]) ?? [];

  const showCancelled = isAccounting && query.batal === "1";
  const correctionQuery = client.from("correction").select("*");
  const corrections = ((await (showCancelled ? correctionQuery : correctionQuery.is("deleted_at", null))
    .order("created_at", { ascending: false })
    .limit(40)).data as Array<CorrectionRow & { deleted_at?: string | null; delete_reason?: string | null }>) ?? [];

  // Tombol Posting nonaktif bila di atas batas BoD dan belum disetujui (dihitung di server).
  const bodRp = paramNumber(parameters, "bod_threshold_rp", 10_000_000);
  const bodPct = paramNumber(parameters, "bod_threshold_pct", 0.02);
  const bodLimitText = `Melebihi batas BoD (Rp ${String(bodRp / 1_000_000).replace(".", ",")} jt / ${String(bodPct * 100).replace(".", ",")} % stok). Menunggu persetujuan BoD.`;
  const needsBod = new Map<string, boolean>();
  for (const row of corrections) {
    if (row.status !== "draft" || row.deleted_at) continue;
    let over = Math.abs(Number(row.amount_rp)) > bodRp;
    if (!over) {
      const stockRows = ((await client
        .from("position_daily")
        .select("date,closing")
        .eq("location_id", row.location_id)
        .lte("date", row.effective_date)
        .order("date", { ascending: false })
        .limit(20)).data as Array<{ date: string; closing: string }>) ?? [];
      const latest = stockRows[0]?.date;
      const stock = Math.abs(stockRows.filter((item) => item.date === latest).reduce((acc, item) => acc + Number(item.closing), 0));
      over = stock > 0 && Math.abs(Number(row.kg)) > bodPct * stock;
    }
    needsBod.set(row.id, over);
  }
  const cancelCorrection = isAccounting && query.koreksi
    ? corrections.find((row) => row.id === query.koreksi && !row.deleted_at) ?? null
    : null;

  const uploads = ((await client
    .from("accurate_upload")
    .select("*")
    .eq("period", period)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })).data as AccurateUploadRow[]) ?? [];
  const reconItems = await loadReconciliationItems(client, period);
  const itemMaps = ((await client.from("item_map").select("*").is("deleted_at", null).order("accurate_item_code")).data as ItemMapRow[]) ?? [];

  const cashBalance = ((await client
    .from("cash_balance")
    .select("*")
    .is("deleted_at", null)
    .order("as_of", { ascending: false })
    .limit(1)).data as CashBalanceRow[]) ?? [];
  const cashPlans = ((await client
    .from("cash_plan")
    .select("*")
    .is("deleted_at", null)
    .order("week_start")).data as CashPlanRow[]) ?? [];

  const startWeek = startOfWeek(today);
  const weeks = Array.from({ length: 13 }, (_, index) => addDays(startWeek, index * 7));
  const periodInfo = periodRange(period);

  const tabs = isAccounting ? TABS : TABS.filter((item) => ["koreksi"].includes(item.key));

  return (
    <>
      <PageHead
        title="Rekon & kunci"
        sub={`${fmtDate(today)} · ${isAccounting ? "accounting" : "BoD (persetujuan koreksi)"}`}
        actions={
          <form action="/rekon" method="get" className="row">
            <input type="hidden" name="tab" value="accurate" />
            <label className="label" htmlFor="period">Periode</label>
            <input id="period" name="period" className="input" defaultValue={period} style={{ maxWidth: 120 }} />
            <button type="submit" className="btn btn-sm">Buka</button>
          </form>
        }
      />

      <nav className="tabs" aria-label="Rekon">
        {tabs.map((item) => (
          <Link key={item.key} href={`/rekon?tab=${item.key}&period=${period}`} aria-current={tab === item.key ? "page" : undefined}>
            {item.label}
          </Link>
        ))}
      </nav>

      {tab === "kunci" && isAccounting ? (
        <div className="stack">
          <Card title="Hari disetujui, menunggu kunci" sub={`${approvedDays.length} hari`}>
            <DataTable
              columns={[
                { key: "lokasi", label: "Lokasi" },
                { key: "tanggal", label: "Tanggal" },
                { key: "disetujui", label: "Disetujui" },
                { key: "aksi", label: "" },
              ]}
              rows={approvedDays.map((row) => ({
                __key: row.id,
                lokasi: `${locationById.get(row.location_id)?.code ?? "—"}`,
                tanggal: fmtDate(row.date),
                disetujui: row.approved_at ? fmtDate(String(row.approved_at).slice(0, 10)) : "—",
                aksi: (
                  <ActionForm action={lockDayAction} submitLabel="Kunci">
                    <input type="hidden" name="location_id" value={row.location_id} />
                    <input type="hidden" name="date" value={row.date} />
                  </ActionForm>
                ),
              }))}
              empty="Tidak ada hari menunggu kunci."
            />
          </Card>
          <Card title="Hari terkunci" sub="Perubahan hanya lewat koreksi">
            <DataTable
              columns={[
                { key: "lokasi", label: "Lokasi" },
                { key: "tanggal", label: "Tanggal" },
                { key: "dikunci", label: "Dikunci" },
              ]}
              rows={lockedDays.map((row) => ({
                __key: row.id,
                lokasi: locationById.get(row.location_id)?.code ?? "—",
                tanggal: fmtDate(row.date),
                dikunci: row.locked_at ? fmtDate(String(row.locked_at).slice(0, 10)) : "—",
              }))}
              empty="Belum ada hari terkunci."
            />
          </Card>
        </div>
      ) : null}

      {tab === "koreksi" ? (
        <div className="stack">
          {isAccounting ? (
            <Card title="Buat koreksi" sub="Di atas Rp 10 jt atau 2 % stok lokasi wajib disetujui BoD">
              <ActionForm action={createCorrectionAction} submitLabel="Simpan koreksi (draft)" resetOnSuccess>
                <div className="form-grid">
                  <SelectInput
                    name="location_id"
                    label="Lokasi"
                    options={locations.map((location) => ({ value: location.id, label: location.code }))}
                  />
                  <DateInput name="effective_date" label="Tanggal efektif" defaultValue={today} required />
                  <SelectInput name="grade_id" label="Grade" options={grades.map((grade) => ({ value: grade.id, label: grade.code }))} />
                  <TextInput name="kg" label="Kg (±)" defaultValue="0" help="Contoh: -12,5 untuk mengurangi." />
                  <TextInput name="amount_rp" label="Rp (±)" defaultValue="0" />
                  <TextInput name="ref" label="Referensi" defaultValue="RS-05" />
                  <div className="full">
                    <TextInput name="reason" label="Alasan" required />
                  </div>
                  <div className="full">
                    <TextInput name="attachment_path" label="Lampiran (path)" />
                  </div>
                </div>
              </ActionForm>
            </Card>
          ) : null}

          <Card title="Daftar koreksi" sub="Posting membangun ulang posisi dari tanggal efektif">
            <DataTable
              columns={[
                { key: "tanggal", label: "Efektif" },
                { key: "lokasi", label: "Lokasi" },
                { key: "grade", label: "Grade" },
                { key: "kg", label: "Kg", numeric: true },
                { key: "rp", label: "Rp", numeric: true },
                { key: "alasan", label: "Alasan" },
                { key: "status", label: "Status" },
                { key: "aksi", label: "" },
              ]}
              rows={corrections.map((row) => ({
                __key: row.id,
                tanggal: fmtDate(row.effective_date),
                lokasi: locationById.get(row.location_id)?.code ?? "—",
                grade: gradeById.get(row.grade_id)?.code ?? "—",
                kg: fmtKg(row.kg, 1),
                rp: fmtRp(row.amount_rp),
                alasan: row.reason,
                status: row.deleted_at ? (
                  <span style={{ textDecoration: "line-through" }} title={row.delete_reason ?? undefined}>
                    <StatusChip status="neutral" label="Dibatalkan" />
                  </span>
                ) : row.status === "posted" ? (
                  <StatusChip status="ok" label="Diposting" />
                ) : row.status === "approved" ? (
                  <StatusChip status="approved" label="Disetujui BoD" />
                ) : (
                  <StatusChip status="draft" label="Draft" />
                ),
                aksi: row.deleted_at ? null : (
                  <div className="row">
                    {row.status !== "posted" && viewer.role === "bod" ? (
                      <ActionForm action={approveCorrectionAction} submitLabel="Setujui">
                        <input type="hidden" name="correction_id" value={row.id} />
                      </ActionForm>
                    ) : null}
                    {row.status !== "posted" && isAccounting ? (
                      needsBod.get(row.id) ? (
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled
                          title={bodLimitText}
                        >
                          Posting
                        </button>
                      ) : (
                        <ActionForm action={postCorrectionAction} submitLabel="Posting">
                          <input type="hidden" name="correction_id" value={row.id} />
                        </ActionForm>
                      )
                    ) : null}
                    {isAccounting ? (
                      <Link href={`/rekon?tab=koreksi&koreksi=${row.id}`} className="btn btn-sm">
                        Batalkan
                      </Link>
                    ) : null}
                  </div>
                ),
              }))}
              empty="Belum ada koreksi."
            />
            {isAccounting ? (
              <p className="small" style={{ marginTop: 8 }}>
                {showCancelled ? (
                  <Link href="/rekon?tab=koreksi">Sembunyikan yang dibatalkan</Link>
                ) : (
                  <Link href="/rekon?tab=koreksi&batal=1">Tampilkan yang dibatalkan</Link>
                )}
              </p>
            ) : null}
          </Card>
          {cancelCorrection ? (
            <Card
              title="Batalkan koreksi"
              sub={`${fmtDate(cancelCorrection.effective_date)} · ${locationById.get(cancelCorrection.location_id)?.code ?? "—"} · ${fmtKg(cancelCorrection.kg, 1)} kg`}
            >
              <ActionForm
                action={cancelCorrectionAction}
                buttons={[{ label: "Batalkan koreksi", variant: "danger", confirm: "Yakin membatalkan koreksi ini? Data tetap tersimpan dengan jejak." }]}
              >
                <input type="hidden" name="correction_id" value={cancelCorrection.id} />
                <TextInput
                  name="delete_reason"
                  label="Alasan pembatalan"
                  help="Wajib minimal 10 karakter untuk koreksi yang sudah diposting."
                />
              </ActionForm>
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === "accurate" && isAccounting ? (
        <div className="stack">
          <div className="grid grid-2">
            <Card title="Unggah penjualan Accurate" sub={`Sales by Item Detail · ${period}`}>
              <ActionForm action={uploadAccurateAction} submitLabel="Unggah penjualan">
                <input type="hidden" name="kind" value="sales" />
                <input type="hidden" name="period" value={period} />
                <div className="field">
                  <label htmlFor="sales_file">Berkas XLSX/CSV</label>
                  <input id="sales_file" name="file" type="file" accept=".xlsx,.xls,.csv" className="input" required />
                </div>
              </ActionForm>
            </Card>
            <Card title="Unggah persediaan Accurate" sub={`Inventory Valuation · ${period}`}>
              <ActionForm action={uploadAccurateAction} submitLabel="Unggah persediaan">
                <input type="hidden" name="kind" value="stock" />
                <input type="hidden" name="period" value={period} />
                <div className="field">
                  <label htmlFor="stock_file">Berkas XLSX/CSV</label>
                  <input id="stock_file" name="file" type="file" accept=".xlsx,.xls,.csv" className="input" required />
                </div>
              </ActionForm>
            </Card>
          </div>

          <Card title="Ekspor Accurate tercatat" sub={`${uploads.length} unggahan untuk ${period}`}>
            <DataTable
              columns={[
                { key: "jenis", label: "Jenis" },
                { key: "baris", label: "Baris", numeric: true },
                { key: "status", label: "Status" },
                { key: "dibuat", label: "Dibuat" },
              ]}
              rows={uploads.map((row) => ({
                __key: row.id,
                jenis: row.kind === "sales" ? "Penjualan" : "Persediaan",
                baris: row.rows,
                status: row.status,
                dibuat: fmtDate(String(row.created_at ?? "").slice(0, 10)),
              }))}
              empty="Belum ada unggahan periode ini."
            />
            <div className="row" style={{ marginTop: 10 }}>
              <ActionForm action={saveReconciliationAction} submitLabel="Hitung rekonsiliasi">
                <input type="hidden" name="period" value={period} />
              </ActionForm>
              <span className="small muted">Periode {periodInfo.start} s.d. {periodInfo.end}</span>
            </div>
          </Card>

          <Card title="Selisih rekonsiliasi" sub="Kg, Rp, dan stok akhir bulan per grade">
            <DataTable
              columns={[
                { key: "grade", label: "Grade" },
                { key: "kind", label: "Jenis" },
                { key: "app", label: "Aplikasi", numeric: true },
                { key: "accurate", label: "Accurate", numeric: true },
                { key: "diff", label: "Selisih", numeric: true },
                { key: "status", label: "Status" },
                { key: "aksi", label: "" },
              ]}
              rows={reconItems.map((item) => ({
                __key: item.id,
                grade: item.grade_id ? gradeById.get(item.grade_id)?.code ?? "—" : "Semua",
                kind: item.kind === "kg" ? "Kg" : item.kind === "rp" ? "Rp" : "Stok kg",
                app: item.kind === "rp" ? fmtRp(item.app_value) : fmtKg(item.app_value, 1),
                accurate: item.kind === "rp" ? fmtRp(item.accurate_value) : fmtKg(item.accurate_value, 1),
                diff: item.kind === "rp" ? fmtRp(item.diff) : fmtKg(item.diff, 1),
                status: <StatusChip status={item.status === "open" ? "warn" : item.status === "explained" ? "approved" : "locked"} label={item.status === "open" ? "Terbuka" : item.status === "explained" ? "Dijelaskan" : "Dikoreksi"} />,
                aksi: (
                  <ActionForm action={updateReconItemAction} submitLabel="Simpan status">
                    <input type="hidden" name="item_id" value={item.id} />
                    <SelectInput
                      name="status"
                      label="Status"
                      defaultValue={item.status}
                      options={[
                        { value: "open", label: "Terbuka" },
                        { value: "explained", label: "Dijelaskan" },
                        { value: "corrected", label: "Dikoreksi" },
                      ]}
                    />
                    <TextInput name="note" label="Penjelasan" defaultValue={item.note ?? ""} />
                  </ActionForm>
                ),
              }))}
              empty="Tidak ada selisih (atau rekonsiliasi belum dihitung)."
            />
          </Card>

          <Card title="Pemetaan item Accurate → grade" sub="Item tanpa map menggagalkan upload">
            <DataTable
              columns={[
                { key: "kode", label: "Kode item" },
                { key: "grade", label: "Grade" },
                { key: "satuan", label: "Satuan" },
                { key: "faktor", label: "Faktor ke kg", numeric: true },
              ]}
              rows={itemMaps.map((row) => ({
                __key: row.id,
                kode: <code>{row.accurate_item_code}</code>,
                grade: gradeById.get(row.grade_id)?.code ?? "—",
                satuan: row.accurate_unit,
                faktor: fmtKg(row.factor_to_kg, 3),
              }))}
              empty="Belum ada pemetaan."
            />
            <div style={{ marginTop: 10 }}>
              <ActionForm action={saveItemMapAction} submitLabel="Simpan pemetaan" resetOnSuccess>
                <div className="form-grid">
                  <TextInput name="accurate_item_code" label="Kode item Accurate" required />
                  <SelectInput name="grade_id" label="Grade" options={grades.map((grade) => ({ value: grade.id, label: grade.code }))} />
                  <TextInput name="accurate_unit" label="Satuan Accurate" defaultValue="kg" />
                  <TextInput name="factor_to_kg" label="Faktor ke kg" defaultValue="1" />
                </div>
              </ActionForm>
            </div>
          </Card>
        </div>
      ) : null}

      {tab === "kas" && isAccounting ? (
        <div className="grid grid-2">
          <Card title="Saldo awal kas" sub="Dipakai proyeksi 13 minggu">
            {cashBalance[0] ? (
              <Metric value={fmtRpJt(cashBalance[0].amount_rp)} sub={`per ${fmtDate(cashBalance[0].as_of)}`} />
            ) : (
              <Empty>Belum diisi.</Empty>
            )}
            <div style={{ marginTop: 12 }}>
              <ActionForm action={saveCashBalanceAction} submitLabel="Simpan saldo">
                <div className="form-grid">
                  <DateInput name="as_of" label="Per tanggal" defaultValue={today} required />
                  <TextInput name="amount_rp" label="Saldo awal Rp" required />
                </div>
              </ActionForm>
            </div>
          </Card>

          <Card title="Rencana kas" sub="Keluar/masuk per minggu (13 minggu)">
            <ActionForm action={saveCashPlanAction} submitLabel="Tambah rencana" resetOnSuccess>
              <div className="form-grid">
                <DateInput name="week_start" label="Minggu (Senin)" defaultValue={startWeek} required />
                <TextInput name="category" label="Kategori" required />
                <SelectInput
                  name="direction"
                  label="Arah"
                  options={[
                    { value: "out", label: "Keluar" },
                    { value: "in", label: "Masuk" },
                  ]}
                />
                <TextInput name="amount_rp" label="Jumlah Rp" required />
              </div>
            </ActionForm>
          </Card>

          <Card title="Rencana kas tersimpan" sub="13 minggu · kategori utama pakan, gaji, obat, listrik, angsuran, bunga, pihak berelasi">
            <DataTable
              columns={[
                { key: "minggu", label: "Minggu" },
                { key: "kategori", label: "Kategori" },
                { key: "arah", label: "Arah" },
                { key: "rp", label: "Rp", numeric: true },
              ]}
              rows={cashPlans
                .filter((plan) => weeks.includes(plan.week_start))
                .map((plan) => ({
                  __key: plan.id,
                  minggu: fmtDate(plan.week_start),
                  kategori: plan.category,
                  arah: plan.direction === "in" ? "Masuk" : "Keluar",
                  rp: fmtRp(plan.amount_rp),
                }))}
              empty="Belum ada rencana kas."
            />
            <p className="small muted" style={{ marginTop: 8 }}>
              Ambang hari stok: {alertDays} hari. Proyeksi kas tampil di <Link href="/outlook?tab=kas">Outlook</Link>.
            </p>
          </Card>
        </div>
      ) : null}

      {tab === "import" && isAccounting ? (
        <Card title="Impor CSV log kertas" sub="Satu baris salah = seluruh file ditolak">
          <Banner tone="info">
            Kolom tetap: <code>{IMPORT_COLUMNS.join(", ")}</code>. Jenis: produksi, keluar, susut, mutasi_keluar,
            mutasi_masuk. Untuk mutasi, kolom pelanggan berisi kode lokasi lawan.
          </Banner>
          <div style={{ marginTop: 12 }}>
            <ActionForm action={importCsvAction} submitLabel="Impor file">
              <div className="field">
                <label htmlFor="import_file">Berkas CSV</label>
                <input id="import_file" name="file" type="file" accept=".csv,text/csv" className="input" required />
              </div>
            </ActionForm>
          </div>
        </Card>
      ) : null}

      {tab === "ekspor" && isAccounting ? (
        <div className="grid grid-2">
          <Card title="Ekspor BS 04A" sub="XLSX bagian B dan C sheet Persediaan">
            <form action="/api/export/bs04a" method="get" className="stack">
              <DateInput name="date" label="Tanggal posisi" defaultValue={today} required />
              <button type="submit" className="btn btn-primary">Unduh BS 04A</button>
            </form>
          </Card>
          <Card title="Draft Usulan Koreksi" sub="Referensi RS-05">
            <p className="small muted" style={{ marginBottom: 8 }}>
              Hitung rekonstruksi dulu di <Link href="/rekonstruksi">Rekonstruksi</Link>, lalu unduh draft Dr/Cr seimbang.
            </p>
            <Link href="/rekonstruksi" className="btn btn-primary">Buka rekonstruksi</Link>
          </Card>
        </div>
      ) : null}

      {tab === "kunci" && !isAccounting ? <Banner tone="warn">Hanya accounting yang dapat mengunci hari.</Banner> : null}
    </>
  );
}
