import Link from "next/link";
import Decimal from "decimal.js";
import { D } from "@winata/engine";
import { todayJakarta } from "@winata/db";
import type { CustomerRow, GradeRow, LocationRow, OutboundLineRow, OutboundRow } from "@winata/db";
import { requireRole } from "@/lib/session";
import { viewerClient } from "@/lib/data";
import { fmtDate, fmtKg, fmtRp } from "@/lib/format";
import { Card, PageHead, Banner, Metric } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { ActionForm } from "@/components/ui/ActionForm";
import { DateInput, QuantityInput, SelectInput, TextInput } from "@/components/ui/Inputs";
import { StatusChip } from "@/components/ui/StatusChip";
import { createOutboundAction } from "@/lib/actions/outbound";

export const dynamic = "force-dynamic";

export default async function DoPage() {
  const viewer = await requireRole(["marketing", "accounting", "admin"]);
  const client = await viewerClient(viewer);
  const today = todayJakarta();

  const locations = ((await client.from("location").select("*").eq("active", true).order("code")).data as LocationRow[]) ?? [];
  const customers = ((await client.from("customer").select("*").is("deleted_at", null).order("name")).data as CustomerRow[]) ?? [];
  const grades = ((await client.from("grade").select("*").eq("active", true).order("sort")).data as GradeRow[]) ?? [];
  const outbounds = ((await client
    .from("outbound")
    .select("*")
    .is("deleted_at", null)
    .order("date", { ascending: false })
    .limit(60)).data as OutboundRow[]) ?? [];
  const outboundIds = outbounds.map((row) => row.id);
  const lines =
    outboundIds.length > 0
      ? ((await client.from("outbound_line").select("*").in("outbound_id", outboundIds).is("deleted_at", null)).data as OutboundLineRow[]) ?? []
      : [];

  const customerById = new Map(customers.map((row) => [row.id, row]));
  const locationById = new Map(locations.map((row) => [row.id, row]));
  const gradeById = new Map(grades.map((row) => [row.id, row]));

  const todayDo = outbounds.filter((row) => row.date === today);
  const draftCount = outbounds.filter((row) => row.status === "draft").length;
  const totalKgDoc = lines.reduce((acc, line) => acc.plus(line.kg_doc), new Decimal(0));

  const doRows = outbounds.map((row) => {
    const docLines = lines.filter((line) => line.outbound_id === row.id);
    const docKg = docLines.reduce((acc, line) => acc.plus(line.kg_doc), new Decimal(0));
    const deliveredKg = docLines.reduce((acc, line) => acc.plus(line.kg_delivered ?? line.kg_doc), new Decimal(0));
    const value = docLines.reduce((acc, line) => acc.plus(D(line.kg_doc).times(line.price_per_kg ?? 0)), new Decimal(0));
    return {
      row,
      docKg,
      deliveredKg,
      value,
      diff: deliveredKg.minus(docKg),
      lines: docLines,
    };
  });

  return (
    <>
      <PageHead title="Dokumen keluar (DO)" sub={`${draftCount} draft menunggu serah kandang · ${fmtDate(today)}`} />

      <div className="grid grid-3">
        <Card title="DO hari ini">
          <Metric value={todayDo.length} unit="DO" sub={`${todayDo.filter((row) => row.status === "draft").length} draft`} />
        </Card>
        <Card title="Kg dokumen (60 DO terakhir)">
          <Metric value={fmtKg(totalKgDoc, 1)} unit="kg" sub="Sebelum konfirmasi serah" />
        </Card>
        <Card title="Harga rata-rata">
          <Metric
            value={fmtRp(
              lines.length > 0
                ? lines.reduce((acc, line) => acc.plus(D(line.kg_doc).times(line.price_per_kg ?? 0)), new Decimal(0))
                    .dividedBy(lines.reduce((acc, line) => acc.plus(line.kg_doc), new Decimal(0)) || 1)
                : 0,
            )}
            unit="/kg"
            sub="Tertimbang kg dokumen"
          />
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="DO baru" sub="Nomor otomatis LOK/YYYYMM/NNNN bila dikosongkan">
          <ActionForm action={createOutboundAction} submitLabel="Simpan DO (draft)" resetOnSuccess>
            <div className="form-grid">
              <SelectInput
                name="location_id"
                label="Lokasi asal"
                options={locations.map((location) => ({ value: location.id, label: `${location.code} · ${location.name}` }))}
              />
              <SelectInput
                name="customer_id"
                label="Pelanggan"
                options={customers.map((customer) => ({ value: customer.id, label: `${customer.code} · ${customer.name}` }))}
              />
              <DateInput name="date" label="Tanggal" defaultValue={today} required />
              <TextInput name="do_number" label="Nomor DO (opsional)" />
            </div>
            <div className="divider" />
            <h3 className="card-title" style={{ fontSize: 14 }}>Baris grade</h3>
            <div className="stack">
              {grades.map((grade) => (
                <div key={grade.id} className="form-grid">
                  <QuantityInput name={`qty_${grade.id}`} unitName={`unit_${grade.id}`} label={`${grade.code} · ${grade.name}`} />
                  <TextInput name={`price_${grade.id}`} label={`Harga/kg ${grade.code}`} />
                </div>
              ))}
            </div>
            <TextInput name="note" label="Catatan" />
          </ActionForm>
        </Card>

        <Card title="Daftar DO" sub="Kg dokumen vs kg serah">
          <DataTable
            columns={[
              { key: "nomor", label: "Nomor" },
              { key: "tanggal", label: "Tanggal" },
              { key: "lokasi", label: "Lokasi" },
              { key: "pelanggan", label: "Pelanggan" },
              { key: "doc", label: "Dok kg", numeric: true },
              { key: "serah", label: "Serah kg", numeric: true },
              { key: "status", label: "Status" },
            ]}
            rows={doRows.map(({ row, docKg, deliveredKg }) => ({
              __key: row.id,
              nomor: <strong>{row.do_number}</strong>,
              tanggal: fmtDate(row.date),
              lokasi: locationById.get(row.location_id)?.code ?? "—",
              pelanggan: customerById.get(row.customer_id)?.name ?? "—",
              doc: fmtKg(docKg, 1),
              serah: row.status === "draft" ? "—" : fmtKg(deliveredKg, 1),
              status: (
                <StatusChip
                  status={row.status === "draft" ? "draft" : row.status === "dikirim" ? "approved" : "locked"}
                  label={row.status === "draft" ? "Draft" : row.status === "dikirim" ? "Dikirim" : "Diterima"}
                />
              ),
            }))}
            empty="Belum ada DO."
          />
        </Card>
      </div>

      <Card title="Rincian per grade" sub="Harga dan nilai dokumen">
        <DataTable
          columns={[
            { key: "nomor", label: "Nomor" },
            { key: "grade", label: "Grade" },
            { key: "kg", label: "Kg", numeric: true },
            { key: "harga", label: "Harga/kg", numeric: true },
            { key: "nilai", label: "Nilai", numeric: true },
            { key: "serah", label: "Kg serah", numeric: true },
            { key: "selisih", label: "Selisih", numeric: true },
          ]}
          rows={doRows.flatMap(({ row, lines: docLines }) =>
            docLines.map((line) => ({
              __key: line.id,
              nomor: row.do_number,
              grade: gradeById.get(line.grade_id)?.code ?? "—",
              kg: fmtKg(line.kg_doc, 1),
              harga: fmtRp(line.price_per_kg ?? 0),
              nilai: fmtRp(D(line.kg_doc).times(line.price_per_kg ?? 0)),
              serah: line.kg_delivered ? fmtKg(line.kg_delivered, 1) : "—",
              selisih: line.kg_delivered ? (
                <span className={Number(line.kg_delivered) !== Number(line.kg_doc) ? "negative" : ""}>
                  {fmtKg(new Decimal(line.kg_delivered).minus(line.kg_doc), 1)}
                </span>
              ) : (
                "—"
              ),
            })),
          )}
          empty="Belum ada baris DO."
        />
      </Card>

      <Banner tone="info">
        Nomor DO unik per lokasi. Nomor loncat atau ganda menghasilkan peringatan di dashboard. Serah dikonfirmasi
        kandang di layar Hari ini.
      </Banner>
      <p className="small muted" style={{ marginTop: 8 }}>
        Rencana jual dan harga acuan ada di <Link href="/rencana">Rencana jual</Link>.
      </p>
    </>
  );
}
