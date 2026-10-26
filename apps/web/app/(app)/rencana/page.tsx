import Decimal from "decimal.js";
import { D } from "@winata/engine";
import { addDays } from "@winata/engine";
import { todayJakarta } from "@winata/db";
import type { CustomerRow, GradeRow, MarketPriceRow, OutboundLineRow, OutboundRow, SalesPlanRow } from "@winata/db";
import { requireRole } from "@/lib/session";
import { viewerClient } from "@/lib/data";
import { fmtDate, fmtKg, fmtRp } from "@/lib/format";
import { Card, PageHead, Banner } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { ActionForm } from "@/components/ui/ActionForm";
import { DateInput, SelectInput, TextInput } from "@/components/ui/Inputs";
import { Legend, Sparkline } from "@/components/ui/Charts";
import {
  deleteSalesPlanAction,
  generateForecastAction,
  saveMarketPriceAction,
  saveSalesPlanAction,
} from "@/lib/actions/plan";

export const dynamic = "force-dynamic";

export default async function RencanaPage() {
  const viewer = await requireRole(["marketing", "accounting", "admin"]);
  const client = await viewerClient(viewer);
  const today = todayJakarta();
  const horizon = 14;
  const dates = Array.from({ length: horizon }, (_, index) => addDays(today, index));

  const customers = ((await client.from("customer").select("*").is("deleted_at", null).order("name")).data as CustomerRow[]) ?? [];
  const grades = ((await client.from("grade").select("*").eq("active", true).order("sort")).data as GradeRow[]) ?? [];
  const plans = ((await client
    .from("sales_plan")
    .select("*")
    .gte("date", addDays(today, -1))
    .lte("date", addDays(today, horizon + 6))
    .is("deleted_at", null)
    .order("date")).data as SalesPlanRow[]) ?? [];
  const marketPrices = ((await client
    .from("market_price")
    .select("*")
    .gte("date", addDays(today, -30))
    .is("deleted_at", null)
    .order("date")).data as MarketPriceRow[]) ?? [];

  const outbounds = ((await client
    .from("outbound")
    .select("*")
    .gte("date", addDays(today, -30))
    .in("status", ["dikirim", "diterima"])
    .is("deleted_at", null)).data as OutboundRow[]) ?? [];
  const outboundIds = new Set(outbounds.map((row) => row.id));
  const outboundLines = ((await client
    .from("outbound_line")
    .select("*")
    .is("deleted_at", null)).data as OutboundLineRow[]) ?? [];
  const realizedByDate = new Map<string, { kg: Decimal; rp: Decimal }>();
  for (const line of outboundLines) {
    if (!outboundIds.has(line.outbound_id) || !line.price_per_kg) continue;
    const outbound = outbounds.find((row) => row.id === line.outbound_id);
    if (!outbound) continue;
    const current = realizedByDate.get(outbound.date) ?? { kg: new Decimal(0), rp: new Decimal(0) };
    current.kg = current.kg.plus(line.kg_doc);
    current.rp = current.rp.plus(D(line.kg_doc).times(line.price_per_kg));
    realizedByDate.set(outbound.date, current);
  }
  const priceDates = Array.from(new Set([...realizedByDate.keys(), ...marketPrices.map((row) => row.date)])).sort();
  const realizedSeries = priceDates.map((date) => {
    const entry = realizedByDate.get(date);
    return entry && entry.kg.greaterThan(0) ? entry.rp.dividedBy(entry.kg).toNumber() : 0;
  });
  const marketSeries = priceDates.map((date) => {
    const entry = marketPrices.find((row) => row.date === date);
    return entry ? Number(entry.price_per_kg) : 0;
  });

  const gradeById = new Map(grades.map((grade) => [grade.id, grade]));
  const plansFor = (customerId: string, date: string) =>
    plans.filter((plan) => plan.customer_id === customerId && plan.date === date);

  return (
    <>
      <PageHead
        title="Rencana jual"
        sub={`${fmtDate(today)} · ${horizon} hari ke depan · order (hitam) vs forecast (abu)`}
      />

      <Card title="Grid rencana 14 hari" sub="Kg per pelanggan per hari, semua grade">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="sticky-col">Pelanggan</th>
                {dates.map((date) => (
                  <th key={date} className="num">
                    {fmtDate(date).split(" ").slice(0, 2).join(" ")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id}>
                  <td className="sticky-col">
                    <strong>{customer.name}</strong>
                    <div className="small muted">{customer.kind}{customer.is_related_party ? " · berelasi" : ""}</div>
                  </td>
                  {dates.map((date) => {
                    const cellPlans = plansFor(customer.id, date);
                    const orderKg = cellPlans.filter((plan) => plan.kind === "order").reduce((acc, plan) => acc.plus(plan.kg), new Decimal(0));
                    const forecastKg = cellPlans.filter((plan) => plan.kind === "forecast").reduce((acc, plan) => acc.plus(plan.kg), new Decimal(0));
                    return (
                      <td key={date} className="num">
                        {orderKg.greaterThan(0) ? <div><strong>{fmtKg(orderKg, 0)}</strong> <span className="small">kg</span></div> : null}
                        {forecastKg.greaterThan(0) ? <div className="muted small">{fmtKg(forecastKg, 0)} kg (forecast)</div> : null}
                        {cellPlans.length === 0 ? <span className="muted">—</span> : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="legend" style={{ marginTop: 6 }}>
          <span><strong>Hitam</strong> = order komitmen</span>
          <span className="muted">Abu = forecast yang bisa ditimpa</span>
        </div>
      </Card>

      <div className="grid grid-2" style={{ marginTop: 12 }}>
        <Card title="Tambah rencana" sub="Order menimpa forecast pada tanggal + grade yang sama">
          <ActionForm action={saveSalesPlanAction} submitLabel="Simpan rencana" resetOnSuccess>
            <div className="form-grid">
              <SelectInput
                name="customer_id"
                label="Pelanggan"
                options={customers.map((customer) => ({ value: customer.id, label: customer.name }))}
              />
              <SelectInput name="grade_id" label="Grade" options={grades.map((grade) => ({ value: grade.id, label: grade.code }))} />
              <DateInput name="date" label="Tanggal" defaultValue={today} required />
              <SelectInput
                name="kind"
                label="Jenis"
                options={[
                  { value: "order", label: "Order (komitmen)" },
                  { value: "forecast", label: "Forecast" },
                ]}
              />
              <TextInput name="kg" label="Kg" required />
              <TextInput name="price_per_kg" label="Harga per kg" />
            </div>
          </ActionForm>
        </Card>

        <Card title="Forecast default" sub="Rata-rata keluar 4 minggu terakhir per hari dalam minggu">
          <ActionForm action={generateForecastAction} submitLabel="Buat forecast 14 hari">
            <div className="form-grid">
              <SelectInput
                name="customer_id"
                label="Pelanggan"
                options={customers.map((customer) => ({ value: customer.id, label: customer.name }))}
              />
              <SelectInput name="grade_id" label="Grade" options={grades.map((grade) => ({ value: grade.id, label: grade.code }))} />
              <DateInput name="from_date" label="Mulai" defaultValue={today} required />
            </div>
          </ActionForm>
          <p className="small muted" style={{ marginTop: 8 }}>
            Forecast yang sudah ada akan diperbarui. Marketing dapat menimpa per hari setelahnya.
          </p>
        </Card>
      </div>

      <Card title="Rencana tersimpan" sub="14 hari ke depan (dan kemarin)">
        <DataTable
          columns={[
            { key: "tanggal", label: "Tanggal" },
            { key: "pelanggan", label: "Pelanggan" },
            { key: "grade", label: "Grade" },
            { key: "kg", label: "Kg", numeric: true },
            { key: "harga", label: "Harga", numeric: true },
            { key: "jenis", label: "Jenis" },
            { key: "aksi", label: "" },
          ]}
          rows={plans.map((plan) => ({
            __key: plan.id,
            tanggal: fmtDate(plan.date),
            pelanggan: customers.find((customer) => customer.id === plan.customer_id)?.name ?? "—",
            grade: gradeById.get(plan.grade_id)?.code ?? "—",
            kg: fmtKg(plan.kg, 0),
            harga: plan.price_per_kg ? fmtRp(plan.price_per_kg) : "—",
            jenis: plan.kind === "order" ? "Order" : "Forecast",
            aksi: (
              <ActionForm action={deleteSalesPlanAction} submitLabel="Hapus">
                <input type="hidden" name="plan_id" value={plan.id} />
              </ActionForm>
            ),
          }))}
          empty="Belum ada rencana."
        />
      </Card>

      <div className="grid grid-2" style={{ marginTop: 12 }}>
        <Card title="Harga realisasi vs acuan" sub="30 hari terakhir; harga tertimbang per hari">
          <Legend
            items={[
              { label: "Realisasi", color: "var(--accent)" },
              { label: "Acuan pasar", color: "var(--warn)" },
            ]}
          />
          <Sparkline
            series={[
              { label: "Realisasi", color: "var(--accent)", points: realizedSeries },
              { label: "Acuan", color: "var(--warn)", points: marketSeries },
            ]}
            ariaLabel="Harga realisasi dan harga acuan 30 hari terakhir"
          />
          <div className="small muted">Tanggal: {priceDates.length > 0 ? `${fmtDate(priceDates[0])} – ${fmtDate(priceDates[priceDates.length - 1])}` : "belum ada data"}</div>
        </Card>

        <Card title="Harga acuan pasar" sub="Input harian per wilayah">
          <ActionForm action={saveMarketPriceAction} submitLabel="Simpan harga" resetOnSuccess>
            <div className="form-grid">
              <DateInput name="date" label="Tanggal" defaultValue={today} required />
              <TextInput name="region" label="Wilayah" defaultValue="Tasikmalaya" />
              <TextInput name="price_per_kg" label="Harga per kg" required />
              <TextInput name="note" label="Catatan" />
            </div>
          </ActionForm>
          <div className="divider" />
          <DataTable
            columns={[
              { key: "tanggal", label: "Tanggal" },
              { key: "wilayah", label: "Wilayah" },
              { key: "harga", label: "Harga/kg", numeric: true },
            ]}
            rows={[...marketPrices].reverse().slice(0, 10).map((row) => ({
              __key: row.id,
              tanggal: fmtDate(row.date),
              wilayah: row.region,
              harga: fmtRp(row.price_per_kg),
            }))}
            empty="Belum ada harga acuan."
          />
        </Card>
      </div>

      <Banner tone="info">
        Forecast default memakai pola hari dalam minggu dari 4 minggu terakhir. Order adalah komitmen dan dipakai lebih
        dulu di posisi proyeksi.
      </Banner>
    </>
  );
}
