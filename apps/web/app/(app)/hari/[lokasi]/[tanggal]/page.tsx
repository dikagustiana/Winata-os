import Link from "next/link";
import { notFound } from "next/navigation";
import { addDays, type Unit } from "@winata/engine";
import { todayJakarta } from "@winata/db";
import type { CustomerRow, DayStatusRow, GradeRow, HouseRow, LocationRow, OutboundLineRow, OutboundRow, PositionDailyRow } from "@winata/db";
import { requireRole } from "@/lib/session";
import { loadConversions, loadDayStatuses, viewerClient } from "@/lib/data";
import { conversionHint } from "@/lib/convert";
import { fmtDate, fmtKg, fmtRp, fmtTime } from "@/lib/format";
import { Card, PageHead, Banner, Metric } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { ActionForm } from "@/components/ui/ActionForm";
import { QuantityInput, SelectInput, TextInput } from "@/components/ui/Inputs";
import { DayStatusChip, EstimateTag, StatusChip } from "@/components/ui/StatusChip";
import { OfflineDayForm } from "@/components/day/OfflineDayForm";
import { saveDayAction, saveShrinkageAction, sendTransferAction, receiveTransferAction } from "@/lib/actions/day";
import { confirmHandoverAction } from "@/lib/actions/outbound";
import Decimal from "decimal.js";

export const dynamic = "force-dynamic";

const DAY_ROLES = ["kandang", "accounting", "admin"] as const;

export default async function HariPage({
  params,
}: {
  params: Promise<{ lokasi: string; tanggal: string }>;
}) {
  const viewer = await requireRole([...DAY_ROLES]);
  const { lokasi, tanggal } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) notFound();
  const client = await viewerClient(viewer);
  const today = todayJakarta();

  const location = ((await client
    .from("location")
    .select("id,code,name,kind,active")
    .eq("code", lokasi.toUpperCase())
    .is("deleted_at", null)
    .maybeSingle()).data as LocationRow | null);
  if (!location) notFound();
  if (viewer.role === "kandang" && !viewer.locationIds.includes(location.id)) notFound();

  const statuses = await loadDayStatuses(client, tanggal);
  const status = statuses.get(location.id)?.status ?? "open";
  const returnReason = statuses.get(location.id)?.return_reason ?? null;
  const locked = status === "locked";
  const approved = status === "approved" || locked;
  const editable = !locked && !(viewer.role === "kandang" && approved) && tanggal <= today;

  const grades = ((await client.from("grade").select("id,code,name,sort,is_saleable").eq("active", true).order("sort")).data as GradeRow[]) ?? [];
  const houses = ((await client.from("house").select("*").eq("location_id", location.id).eq("active", true).order("code")).data as HouseRow[]) ?? [];
  const conversions = await loadConversions(client, tanggal);
  const versions = Array.from(conversions.values()).map((row) => ({
    gradeId: row.grade_id,
    validFrom: row.valid_from,
    kgPerCrate: row.kg_per_crate,
    kgPerTray: row.kg_per_tray,
    eggsPerKg: row.eggs_per_kg,
  }));

  const production =
    houses.length > 0
      ? ((await client
          .from("production")
          .select("id,house_id,grade_id,qty,unit,kg")
          .eq("date", tanggal)
          .in("house_id", houses.map((house) => house.id))
          .is("deleted_at", null)).data as Array<{ id: string; house_id: string; grade_id: string; qty: string; unit: Unit; kg: string }>) ?? []
      : [];
  const productionKey = new Map(production.map((row) => [`${row.house_id}|${row.grade_id}`, row]));

  const shrinkage =
    ((await client
      .from("shrinkage")
      .select("id,grade_id,kg,kind,reason")
      .eq("location_id", location.id)
      .eq("date", tanggal)
      .is("deleted_at", null)).data as Array<{ id: string; grade_id: string; kg: string; kind: string; reason: string | null }>) ?? [];

  const outbounds =
    ((await client
      .from("outbound")
      .select("id,do_number,customer_id,date,status,note")
      .eq("location_id", location.id)
      .in("status", ["draft", "dikirim"])
      .is("deleted_at", null)
      .order("date")).data as OutboundRow[]) ?? [];
  const outboundIds = outbounds.map((row) => row.id);
  const outboundLines =
    outboundIds.length > 0
      ? ((await client
          .from("outbound_line")
          .select("*")
          .in("outbound_id", outboundIds)
          .is("deleted_at", null)).data as OutboundLineRow[]) ?? []
      : [];
  const customers = ((await client.from("customer").select("id,code,name").is("deleted_at", null)).data as CustomerRow[]) ?? [];
  const customerById = new Map(customers.map((row) => [row.id, row]));

  const transfersOut =
    ((await client
      .from("transfer")
      .select("*")
      .eq("from_location_id", location.id)
      .eq("sent_date", tanggal)
      .is("deleted_at", null)).data as Array<{ id: string; to_location_id: string; grade_id: string; kg: string; status: string }>) ?? [];
  const transfersIn =
    ((await client
      .from("transfer")
      .select("*")
      .eq("to_location_id", location.id)
      .eq("status", "in_transit")
      .is("deleted_at", null)).data as Array<{ id: string; from_location_id: string; grade_id: string; kg: string; sent_date: string }>) ?? [];
  const locations = ((await client.from("location").select("id,code,name,kind").eq("active", true).order("code")).data as LocationRow[]) ?? [];
  const locationById = new Map(locations.map((row) => [row.id, row]));

  const positions =
    ((await client.from("position_daily").select("*").eq("location_id", location.id).eq("date", tanggal)).data as PositionDailyRow[]) ?? [];
  const gradeById = new Map(grades.map((grade) => [grade.id, grade]));
  const totalClosing = positions.reduce((acc, row) => acc.plus(row.closing), new Decimal(0));

  const dayStatusRow = ((await client
    .from("day_status")
    .select("*")
    .eq("location_id", location.id)
    .eq("date", tanggal)
    .maybeSingle()).data as DayStatusRow | null) ?? null;

  const prevDate = addDays(tanggal, -1);
  const nextDate = addDays(tanggal, 1);

  return (
    <>
      <PageHead
        title={`${location.name} · ${fmtDate(tanggal)}`}
        sub={
          <span className="row" style={{ gap: 8 }}>
            <DayStatusChip status={status} />
            <span>{location.code}</span>
            {returnReason ? <span className="negative">Dikembalikan: {returnReason}</span> : null}
          </span>
        }
        actions={
          <>
            <Link className="btn btn-sm" href={`/hari/${location.code}/${prevDate}`}>
              ← Sebelumnya
            </Link>
            {nextDate <= today ? (
              <Link className="btn btn-sm" href={`/hari/${location.code}/${nextDate}`}>
                Berikutnya →
              </Link>
            ) : null}
          </>
        }
      />

      {locked ? (
        <Banner tone="ok">
          Hari ini <strong>dikunci</strong>. Perubahan hanya bisa lewat koreksi accounting.
        </Banner>
      ) : approved ? (
        <Banner tone="warn">
          Hari ini sudah <strong>disetujui manager</strong>. Bila ada yang perlu diperbaiki, minta manager mengembalikan
          hari ke draft.
        </Banner>
      ) : null}

      <div className="grid grid-3">
        <Card title="Stok akhir" sub="Semua grade, kg">
          <Metric value={fmtKg(totalClosing, 1)} unit="kg" sub={positions.length === 0 ? "Posisi belum dihitung" : `${positions.length} baris grade`} />
        </Card>
        <Card title="Produksi hari ini" sub="Sesuai input kandang">
          <Metric
            value={fmtKg(production.reduce((acc, row) => acc.plus(row.kg), new Decimal(0)), 1)}
            unit="kg"
            sub={`${production.length} baris`}
          />
        </Card>
        <Card title="DO menunggu serah" sub="Dokumen dari marketing">
          <Metric value={outbounds.filter((row) => row.status === "draft").length} unit="DO" sub="Perlu konfirmasi kandang" />
        </Card>
      </div>

      <OfflineDayForm
        action={saveDayAction}
        storageKey={`hari:${location.code}:${tanggal}`}
        disabled={!editable}
        status={<span className="small">Status hari: {status}</span>}
      >
        <input type="hidden" name="location_id" value={location.id} />
        <input type="hidden" name="date" value={tanggal} />
        {houses.map((house) => (
          <Card key={house.id} title={`Produksi ${house.code}`} sub={house.name}>
            <div className="stack">
              {grades.map((grade) => {
                const existing = productionKey.get(`${house.id}|${grade.id}`);
                const hint = conversionHint(versions, grade, tanggal);
                return (
                  <QuantityInput
                    key={grade.id}
                    name={`qty_${house.id}_${grade.id}`}
                    unitName={`unit_${house.id}_${grade.id}`}
                    label={`${grade.code} · ${grade.name}`}
                    defaultValue={existing ? fmtKg(existing.qty, 3) : ""}
                    defaultUnit={existing?.unit ?? "kg"}
                    conversion={hint}
                  />
                );
              })}
            </div>
          </Card>
        ))}
      </OfflineDayForm>

      <div className="grid grid-2" style={{ marginTop: 12 }}>
        <Card title="Susut, pecah, sampel" sub="Mengurangi posisi hari ini">
          <DataTable
            columns={[
              { key: "grade", label: "Grade" },
              { key: "jenis", label: "Jenis" },
              { key: "kg", label: "Kg", numeric: true },
              { key: "alasan", label: "Alasan" },
            ]}
            rows={shrinkage.map((row) => ({
              __key: row.id,
              grade: gradeById.get(row.grade_id)?.code ?? "—",
              jenis: row.kind,
              kg: fmtKg(row.kg, 1),
              alasan: row.reason ?? "—",
            }))}
            empty="Belum ada susut hari ini."
          />
          {editable ? (
            <div style={{ marginTop: 12 }}>
              <ActionForm action={saveShrinkageAction} submitLabel="Tambah susut" resetOnSuccess>
                <input type="hidden" name="location_id" value={location.id} />
                <input type="hidden" name="date" value={tanggal} />
                <div className="form-grid">
                  <SelectInput
                    name="grade_id"
                    label="Grade"
                    options={grades.map((grade) => ({ value: grade.id, label: grade.code }))}
                  />
                  <SelectInput
                    name="kind"
                    label="Jenis"
                    options={[
                      { value: "pecah", label: "Pecah" },
                      { value: "afkir_telur", label: "Afkir telur" },
                      { value: "konsumsi", label: "Konsumsi" },
                      { value: "sampel", label: "Sampel" },
                      { value: "lain", label: "Lain" },
                    ]}
                  />
                  <QuantityInput name="qty" label="Jumlah" />
                  <TextInput name="reason" label="Alasan" />
                </div>
              </ActionForm>
            </div>
          ) : null}
        </Card>

        <Card title="DO & serah" sub="Dokumen marketing; kandang mengonfirmasi kg aktual">
          {outbounds.length === 0 ? (
            <div className="empty">Belum ada DO untuk lokasi ini.</div>
          ) : (
            <div className="stack">
              {outbounds.map((outbound) => {
                const lines = outboundLines.filter((line) => line.outbound_id === outbound.id);
                return (
                  <div key={outbound.id} className="banner">
                    <div className="spread">
                      <strong>{outbound.do_number}</strong>
                      <StatusChip status={outbound.status === "draft" ? "draft" : "approved"} label={outbound.status === "draft" ? "Draft" : "Dikirim"} />
                    </div>
                    <div className="small muted">
                      {customerById.get(outbound.customer_id)?.name ?? "—"} · {fmtDate(outbound.date)}
                    </div>
                    <table className="table" style={{ marginTop: 6 }}>
                      <thead>
                        <tr>
                          <th>Grade</th>
                          <th className="num">Dokumen kg</th>
                          <th className="num">Harga/kg</th>
                          <th className="num">Serah kg</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((line) => (
                          <tr key={line.id}>
                            <td>{gradeById.get(line.grade_id)?.code ?? "—"}</td>
                            <td className="num">{fmtKg(line.kg_doc, 1)}</td>
                            <td className="num">{line.price_per_kg ? fmtRp(line.price_per_kg) : "—"}</td>
                            <td className="num">
                              {outbound.status === "draft" && editable ? (
                                <input
                                  form={`serah-${outbound.id}`}
                                  name={`kg_${line.id}`}
                                  className="input"
                                  inputMode="decimal"
                                  defaultValue={fmtKg(line.kg_doc, 3)}
                                  style={{ maxWidth: 120, minHeight: 38, textAlign: "right" }}
                                  aria-label={`Kg serah ${gradeById.get(line.grade_id)?.code ?? ""}`}
                                />
                              ) : (
                                fmtKg(line.kg_delivered ?? line.kg_doc, 1)
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {outbound.status === "draft" && editable ? (
                      <div style={{ marginTop: 8 }}>
                        <ActionForm action={confirmHandoverAction} submitLabel="Sudah diserahkan" formId={`serah-${outbound.id}`}>
                          <input type="hidden" name="outbound_id" value={outbound.id} />
                        </ActionForm>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-2" style={{ marginTop: 12 }}>
        <Card title="Mutasi keluar" sub="Kg keluar dari posisi pada tanggal kirim">
          <DataTable
            columns={[
              { key: "tujuan", label: "Tujuan" },
              { key: "grade", label: "Grade" },
              { key: "kg", label: "Kg", numeric: true },
              { key: "status", label: "Status" },
            ]}
            rows={transfersOut.map((row) => ({
              __key: row.id,
              tujuan: locationById.get(row.to_location_id)?.code ?? "—",
              grade: gradeById.get(row.grade_id)?.code ?? "—",
              kg: fmtKg(row.kg, 1),
              status: row.status === "in_transit" ? "Di jalan" : "Diterima",
            }))}
            empty="Belum ada mutasi keluar."
          />
          {editable ? (
            <div style={{ marginTop: 12 }}>
              <ActionForm action={sendTransferAction} submitLabel="Kirim mutasi" resetOnSuccess>
                <input type="hidden" name="from_location_id" value={location.id} />
                <input type="hidden" name="sent_date" value={tanggal} />
                <div className="form-grid">
                  <SelectInput
                    name="to_location_id"
                    label="Tujuan"
                    options={locations.filter((row) => row.id !== location.id).map((row) => ({ value: row.id, label: `${row.code} · ${row.name}` }))}
                  />
                  <SelectInput name="grade_id" label="Grade" options={grades.map((grade) => ({ value: grade.id, label: grade.code }))} />
                  <QuantityInput name="qty" label="Jumlah" />
                  <TextInput name="note" label="Catatan" />
                </div>
              </ActionForm>
            </div>
          ) : null}
        </Card>

        <Card title="Menunggu diterima" sub="Mutasi masuk ke lokasi ini">
          <DataTable
            columns={[
              { key: "asal", label: "Asal" },
              { key: "grade", label: "Grade" },
              { key: "kg", label: "Kg", numeric: true },
              { key: "kirim", label: "Dikirim" },
              { key: "aksi", label: "" },
            ]}
            rows={transfersIn.map((row) => ({
              __key: row.id,
              asal: locationById.get(row.from_location_id)?.code ?? "—",
              grade: gradeById.get(row.grade_id)?.code ?? "—",
              kg: fmtKg(row.kg, 1),
              kirim: fmtDate(row.sent_date),
              aksi: editable ? (
                <ActionForm action={receiveTransferAction} submitLabel="Terima" formId={`terima-${row.id}`}>
                  <input type="hidden" name="transfer_id" value={row.id} />
                  <input type="hidden" name="received_date" value={tanggal} />
                </ActionForm>
              ) : null,
            }))}
            empty="Tidak ada mutasi di jalan."
          />
        </Card>
      </div>

      <Card title="Ringkasan hari per grade" sub="Dibaca dari position_daily setelah worker membangun ulang">
        <DataTable
          columns={[
            { key: "grade", label: "Grade" },
            { key: "opening", label: "Awal", numeric: true },
            { key: "production", label: "Produksi", numeric: true },
            { key: "transferIn", label: "Masuk", numeric: true },
            { key: "outbound", label: "Keluar", numeric: true },
            { key: "transferOut", label: "Kirim", numeric: true },
            { key: "shrinkage", label: "Susut", numeric: true },
            { key: "correction", label: "Koreksi", numeric: true },
            { key: "closing", label: "Akhir", numeric: true },
          ]}
          rows={positions.map((row) => ({
            __key: row.grade_id,
            grade: gradeById.get(row.grade_id)?.code ?? "—",
            opening: fmtKg(row.opening, 1),
            production: fmtKg(row.production, 1),
            transferIn: fmtKg(row.transfer_in, 1),
            outbound: fmtKg(row.outbound, 1),
            transferOut: fmtKg(row.transfer_out, 1),
            shrinkage: fmtKg(row.shrinkage, 1),
            correction: fmtKg(row.correction, 1),
            closing: <span className={Number(row.closing) < 0 ? "negative" : undefined}>{fmtKg(row.closing, 1)}</span>,
          }))}
          empty="Belum ada posisi untuk tanggal ini. Simpan produksi untuk menghitung."
        />
        <div className="row" style={{ justifyContent: "space-between", marginTop: 8 }}>
          <span className="small muted">
            Di jalan menuju lokasi ini:{" "}
            {fmtKg(transfersIn.reduce((acc, row) => acc.plus(row.kg), new Decimal(0)), 1)} kg
          </span>
          <span className="small muted">
            {dayStatusRow?.submitted_at ? `Diserahkan ${fmtTime(String(dayStatusRow.submitted_at))}` : ""}
            {dayStatusRow?.approved_at ? ` · Disetujui ${fmtTime(String(dayStatusRow.approved_at))}` : ""}
            {dayStatusRow?.locked_at ? ` · Dikunci ${fmtTime(String(dayStatusRow.locked_at))}` : ""}
          </span>
        </div>
      </Card>

      <p className="small muted" style={{ marginTop: 10 }}>
        Posisi memakai <EstimateTag /> dan satuan kg. Butir diturunkan dari versi konversi tanggal ini.
        {conversions.size === 0 ? " Konversi satuan belum ada untuk tanggal ini." : ""}
      </p>
    </>
  );
}
