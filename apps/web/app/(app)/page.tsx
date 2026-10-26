import Link from "next/link";
import type { ReactNode } from "react";
import Decimal from "decimal.js";
import { addDays } from "@winata/engine";
import { todayJakarta } from "@winata/db";
import type { ControlResultRow, GradeRow, PositionDailyRow } from "@winata/db";
import { Card, Empty, Metric, PageHead, Banner } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { DayStatusChip, EstimateTag, StatusChip } from "@/components/ui/StatusChip";
import { Bars, Legend, Sparkline } from "@/components/ui/Charts";
import { AutoRefresh } from "@/components/ui/AutoRefresh";
import { requireViewer } from "@/lib/session";
import {
  byId,
  loadConversions,
  loadDayStatuses,
  loadGrades,
  loadLocations,
  loadParameters,
  param,
  paramNumber,
  viewerClient,
} from "@/lib/data";
import { fmtDate, fmtDateTime, fmtEggs, fmtKg, fmtNumber, fmtRpJt } from "@/lib/format";

const WHOLE_GRADES = ["UB", "US", "UK"];

const CONTROL_TEXT: Record<string, { title: string; fix: string; href: string }> = {
  K1: { title: "Lokasi belum menyelesaikan hari sampai batas jam", fix: "Buka hari kandang", href: "/hari" },
  K2: { title: "Stok akhir negatif", fix: "Periksa produksi atau keluar", href: "/hari" },
  K3: { title: "Nomor DO ganda atau loncat", fix: "Buka daftar DO", href: "/do" },
  K4: { title: "Selisih hitung fisik melebihi toleransi", fix: "Buka hitung fisik", href: "/fisik" },
  K5: { title: "Mutasi lebih dari sehari di jalan", fix: "Buka hari kandang", href: "/hari" },
  K6: { title: "Stok berumur lebih dari 7 hari", fix: "Lihat posisi proyeksi", href: "/outlook" },
  K7: { title: "Hari stok di atas ambang", fix: "Lihat rencana jual", href: "/outlook" },
};

function sum(rows: PositionDailyRow[], field: keyof PositionDailyRow): Decimal {
  return rows.reduce((acc, row) => acc.plus(new Decimal(String(row[field] ?? 0))), new Decimal(0));
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k) ?? [];
    list.push(row);
    map.set(k, list);
  }
  return map;
}

function weightedDaysOfStock(rows: PositionDailyRow[]): Decimal | null {
  let weight = new Decimal(0);
  let closing = new Decimal(0);
  for (const row of rows) {
    if (!row.days_of_stock) continue;
    const kg = new Decimal(row.closing);
    if (kg.lessThanOrEqualTo(0)) continue;
    weight = weight.plus(kg.times(row.days_of_stock));
    closing = closing.plus(kg);
  }
  if (closing.isZero()) return null;
  return weight.dividedBy(closing);
}

export default async function DashboardPage() {
  const viewer = await requireViewer();
  const client = await viewerClient(viewer);
  const today = todayJakarta();
  const params = await loadParameters(client, today);
  const alertDays = paramNumber(params, "days_of_stock_alert", 5);
  const bucketDays = param<number[]>(params, "age_buckets_days", [3, 7, 14]);

  const locations = await loadLocations(client, viewer);
  const grades = await loadGrades(client);
  const conversions = await loadConversions(client, today);

  const wholeIds = new Set(grades.filter((g) => WHOLE_GRADES.includes(g.code)).map((g) => g.id));

  const locationFilter = new Set(locations.map((l) => l.id));

  const latest = await client
    .from("position_daily")
    .select("date")
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const positionDate = latest.data?.date ?? today;
  const isToday = positionDate === today;

  const { data: positionData } = await client
    .from("position_daily")
    .select("*")
    .eq("date", positionDate)
    .order("location_id");
  const rows = ((positionData as PositionDailyRow[] | null) ?? []).filter((row) =>
    locationFilter.has(row.location_id),
  );

  const { data: previousData } = await client
    .from("position_daily")
    .select("*")
    .eq("date", addDays(positionDate, -1));
  const previousRows = ((previousData as PositionDailyRow[] | null) ?? []).filter((row) =>
    locationFilter.has(row.location_id),
  );

  const dayStatuses = await loadDayStatuses(client, positionDate);

  const { data: controlData } = await client
    .from("control_result")
    .select("*")
    .eq("date", positionDate);
  const controls = ((controlData as ControlResultRow[] | null) ?? []).filter((row) =>
    locationFilter.has(row.location_id),
  );

  const { data: lastPhysicalData } = await client
    .from("control_result")
    .select("*")
    .eq("code", "K4")
    .order("date", { ascending: false })
    .limit(30);
  const lastPhysical = ((lastPhysicalData as ControlResultRow[] | null) ?? []).find(
    (row) => row.detail && typeof row.detail === "object" && "diff_kg" in row.detail,
  );

  const historyFrom = addDays(positionDate, -29);
  const { data: historyData } = await client
    .from("position_daily")
    .select("date,production,outbound,shrinkage,closing,grade_id,location_id")
    .gte("date", historyFrom)
    .lte("date", positionDate);
  const historyRows = ((historyData as PositionDailyRow[] | null) ?? []).filter((row) =>
    locationFilter.has(row.location_id),
  );

  if (rows.length === 0) {
    return (
      <>
        <PageHead title="Posisi telur" sub={`${fmtDate(positionDate)} · ${viewer.locations.map((l) => l.name).join(" · ") || "semua lokasi"}`} />
        <Banner tone="info">
          Belum ada posisi. Posisi muncul setelah opname T0 atau produksi pertama dibukukan. Buka layar{" "}
          <Link href="/hari">Hari ini</Link> untuk mulai mencatat.
        </Banner>
      </>
    );
  }

  const wholeRows = rows.filter((row) => wholeIds.has(row.grade_id));
  const previousWholeRows = previousRows.filter((row) => wholeIds.has(row.grade_id));
  const totalWholeKg = sum(wholeRows, "closing");
  const previousWholeKg = sum(previousWholeRows, "closing");
  const delta = totalWholeKg.minus(previousWholeKg);
  const totalValueRp = sum(rows, "value_rp");
  const inTransitTotal = sum(rows, "in_transit");

  const eggsPerKg = (gradeId: string): Decimal => {
    const conversion = conversions.get(gradeId);
    return conversion?.eggs_per_kg ? new Decimal(conversion.eggs_per_kg) : new Decimal(0);
  };
  const totalEggs = wholeRows.reduce(
    (acc, row) => acc.plus(new Decimal(row.closing).times(eggsPerKg(row.grade_id))),
    new Decimal(0),
  );

  const totalDaysOfStock = weightedDaysOfStock(rows);
  const totalClosing = sum(rows, "closing");

  const aging = rows.reduce(
    (acc, row) => ({
      b1: acc.b1.plus(row.age_b1),
      b2: acc.b2.plus(row.age_b2),
      b3: acc.b3.plus(row.age_b3),
      b4: acc.b4.plus(row.age_b4),
    }),
    { b1: new Decimal(0), b2: new Decimal(0), b3: new Decimal(0), b4: new Decimal(0) },
  );
  const overSeven = aging.b3.plus(aging.b4);

  const historyByDate = groupBy(historyRows, (row) => row.date);
  const dates = Array.from(historyByDate.keys()).sort();
  const productionSeries = dates.map((d) => sum(historyByDate.get(d) ?? [], "production").toNumber());
  const outboundSeries = dates.map((d) => sum(historyByDate.get(d) ?? [], "outbound").toNumber());
  const shrinkSeries = dates.slice(-14).map((d) => sum(historyByDate.get(d) ?? [], "shrinkage").toNumber());
  const todayProduction = sum(historyByDate.get(positionDate) ?? [], "production");
  const todayOutbound = sum(historyByDate.get(positionDate) ?? [], "outbound");
  const todayShrink = sum(historyByDate.get(positionDate) ?? [], "shrinkage");

  const locationById = byId(locations);
  const alerts = controls.filter((row) => row.status !== "ok");
  const controlCodes = ["K1", "K2", "K3", "K4", "K5", "K6", "K7"];
  const controlsByCode = groupBy(alerts, (row) => row.code);

  const locationColumnRows = locations.map((location) => {
    const locRows = rows.filter((row) => row.location_id === location.id);
    const record: Record<string, ReactNode> = {
      __key: location.id,
      lokasi: (
        <span>
          <strong>{location.code}</strong> <span className="muted small">{location.name}</span>
        </span>
      ),
    };
    for (const grade of grades) {
      const row = locRows.find((r) => r.grade_id === grade.id);
      record[grade.code] = row ? fmtKg(row.closing, 1) : "—";
    }
    record.total = <strong>{fmtKg(sum(locRows, "closing"), 1)}</strong>;
    return record;
  });
  const transitRow: Record<string, ReactNode> = { __key: "transit", lokasi: <span className="muted">Di jalan</span> };
  for (const grade of grades) {
    const transitGrade = rows.filter((row) => row.grade_id === grade.id).reduce((acc, row) => acc.plus(row.in_transit), new Decimal(0));
    transitRow[grade.code] = fmtKg(transitGrade, 1);
  }
  transitRow.total = <strong>{fmtKg(inTransitTotal, 1)}</strong>;

  const footerTotals = grades.map((grade) => sum(rows.filter((row) => row.grade_id === grade.id), "closing"));
  const footer = (
    <tr>
      <td className="sticky-col">Total</td>
      {footerTotals.map((value, index) => (
        <td key={grades[index].id} className="num">
          {fmtKg(value, 1)}
        </td>
      ))}
      <td className="num">{fmtKg(totalClosing, 1)}</td>
    </tr>
  );

  const statusChips = locations.map((location) => {
    const status = dayStatuses.get(location.id)?.status ?? "open";
    return (
      <span key={location.id} className="row" style={{ gap: 6 }}>
        <span className="small muted">{location.code}</span>
        <DayStatusChip status={status} />
      </span>
    );
  });

  const agingBars = [
    { label: `0–${bucketDays[0]}`, value: aging.b1.toNumber(), color: "var(--accent)" },
    { label: `${bucketDays[0] + 1}–${bucketDays[1]}`, value: aging.b2.toNumber(), color: "#6c9a72" },
    { label: `${bucketDays[1] + 1}–${bucketDays[2]}`, value: aging.b3.toNumber(), color: "var(--warn)" },
    { label: `>${bucketDays[2]}`, value: aging.b4.toNumber(), color: "var(--fail)" },
  ];

  return (
    <>
      <AutoRefresh seconds={60} />
      <PageHead
        title="Posisi telur"
        sub={`${fmtDate(positionDate)} · diperbarui ${fmtDateTime(new Date())} · HPP sementara`}
        actions={<EstimateTag />}
      />

      <Card title="Status hari" sub={isToday ? "Hari ini" : `Hari terakhir yang punya posisi: ${fmtDate(positionDate)}`}>
        <div className="status-line">{statusChips}</div>
        <p className="small muted" style={{ marginTop: 8 }}>
          Chip menunjukkan status hari: belum isi, draft, disetujui, atau dikunci.
        </p>
      </Card>

      <div className="grid grid-3" style={{ marginTop: 12 }}>
        <Card
          title="Posisi telur utuh"
          sub="UB + US + UK, seluruh lokasi"
          action={<StatusChip status={isToday ? "approved" : "draft"} label={isToday ? "Hari ini" : "Terakhir"} />}
        >
          <Metric
            value={fmtKg(totalWholeKg, 1)}
            unit="kg"
            sub={
              <span>
                {fmtEggs(totalEggs)} butir · {fmtRpJt(totalValueRp)} <EstimateTag />
              </span>
            }
          />
          <div className={`small ${delta.isNegative() ? "negative" : "muted"}`} style={{ marginTop: 8 }}>
            {delta.isNegative() ? "−" : "+"}
            {fmtKg(delta.abs(), 1)} kg vs kemarin
          </div>
          <div className="divider" />
          <dl className="kv">
            <dt>Di jalan</dt>
            <dd>{fmtKg(inTransitTotal, 1)} kg</dd>
            <dt>Hari stok</dt>
            <dd>{totalDaysOfStock ? `${fmtNumber(totalDaysOfStock, 1)} hari` : "—"}</dd>
          </dl>
        </Card>

        <Card title="Hari stok" sub={`Ambang ${alertDays} hari`}>
          <Metric
            value={totalDaysOfStock ? fmtNumber(totalDaysOfStock, 1) : "—"}
            unit="hari"
            sub="Posisi dibagi rata-rata produksi 7 hari"
          />
          <div className="divider" />
          <dl className="kv">
            {locations.map((location) => {
              const dos = weightedDaysOfStock(rows.filter((row) => row.location_id === location.id));
              const over = dos !== null && dos.greaterThan(alertDays);
              return (
                <div key={location.id} style={{ display: "contents" }}>
                  <dt>{location.code}</dt>
                  <dd className={over ? "negative" : undefined}>{dos ? `${fmtNumber(dos, 1)} hari` : "—"}</dd>
                </div>
              );
            })}
          </dl>
          {totalDaysOfStock && totalDaysOfStock.greaterThan(alertDays) ? (
            <p className="small" style={{ marginTop: 8 }}>
              <StatusChip status="warn" label={`Di atas ambang ${alertDays} hari`} />
            </p>
          ) : null}
        </Card>

        <Card title="Umur stok" sub="FIFO per tanggal produksi">
          <Bars data={agingBars} ariaLabel={`Umur stok: ${agingBars.map((b) => `${b.label} hari ${b.value} kg`).join(", ")}`} />
          <div className="divider" />
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="small muted">Lebih dari 7 hari</span>
            <span className="row" style={{ gap: 8 }}>
              <strong className="num">{fmtKg(overSeven, 1)} kg</strong>
              {overSeven.greaterThan(0) ? <StatusChip status="warn" label="Perlu perhatian" /> : <StatusChip status="ok" />}
            </span>
          </div>
        </Card>
      </div>

      <Card title="Posisi per lokasi dan grade" sub={`kg · ${fmtDate(positionDate)}`}>
        <DataTable
          columns={[
            { key: "lokasi", label: "Lokasi" },
            ...grades.map((grade: GradeRow) => ({ key: grade.code, label: grade.code, numeric: true })),
            { key: "total", label: "Total", numeric: true },
          ]}
          rows={[...locationColumnRows, transitRow]}
          footer={footer}
          caption="Posisi telur per lokasi dan grade"
        />
      </Card>

      <div className="grid grid-2" style={{ marginTop: 12 }}>
        <Card title="Produksi vs keluar 30 hari" sub="kg per hari">
          <Legend
            items={[
              { label: "Produksi", color: "var(--accent)" },
              { label: "Keluar", color: "var(--approved)" },
            ]}
          />
          <Sparkline
            series={[
              { label: "Produksi", color: "var(--accent)", points: productionSeries },
              { label: "Keluar", color: "var(--approved)", points: outboundSeries },
            ]}
            ariaLabel={`Produksi dan keluar 30 hari terakhir; hari ini produksi ${todayProduction.toFixed(1)} kg, keluar ${todayOutbound.toFixed(1)} kg`}
          />
          <div className="row" style={{ justifyContent: "space-between", marginTop: 10 }}>
            <span className="small">
              Hari ini: <strong>{fmtKg(todayProduction, 1)} kg</strong> produksi ·{" "}
              <strong>{fmtKg(todayOutbound, 1)} kg</strong> keluar
            </span>
            <span className="small muted">Susut {fmtKg(todayShrink, 1)} kg</span>
          </div>
          <div className="divider" />
          <div className="small muted">Susut 14 hari terakhir</div>
          <Bars
            data={shrinkSeries.map((value, index) => ({
              label: index === shrinkSeries.length - 1 ? "kini" : "",
              value,
              color: "var(--warn)",
            }))}
            height={56}
            ariaLabel={`Susut 14 hari terakhir, total ${shrinkSeries.reduce((a, b) => a + b, 0).toFixed(1)} kg`}
          />
        </Card>

        <Card title="Kontrol hari ini" sub="Peringatan yang perlu ditindaklanjuti">
          {alerts.length === 0 ? (
            <div className="banner banner-ok">Tidak ada perhatian hari ini.</div>
          ) : (
            <div className="stack">
              {controlCodes.map((code) => {
                const items = controlsByCode.get(code);
                if (!items || items.length === 0) return null;
                const info = CONTROL_TEXT[code];
                const worst = items.some((item) => item.status === "fail") ? "fail" : "warn";
                return (
                  <div
                    key={code}
                    className={`banner ${worst === "fail" ? "banner-fail" : "banner-warn"}`}
                    title={code}
                  >
                    <div className="spread">
                      <strong>{info.title}</strong>
                      <StatusChip status={worst} />
                    </div>
                    <div className="small" style={{ marginTop: 4 }}>
                      {Array.from(new Set(items.map((item) => locationById.get(item.location_id)?.code ?? "—"))).join(", ")} ·{" "}
                      <Link href={info.href}>{info.fix}</Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <details className="help">
            <summary>Cara hitung dan sumber baris</summary>
            <div className="help-body">
              Kartu membaca <code>position_daily</code> dan <code>control_result</code> yang ditulis worker. Halaman
              tidak menghitung ulang posisi.
            </div>
          </details>
        </Card>
      </div>

      <Card title="Hitung fisik terakhir" sub={lastPhysical ? fmtDate(lastPhysical.date) : undefined}>
        {lastPhysical ? (
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span>
              Selisih <strong>{fmtKg(String(lastPhysical.detail.diff_kg ?? 0), 1)} kg</strong>{" "}
              <span className="muted small">
                ({fmtNumber(String(lastPhysical.detail.diff_pct ?? 0), 2)} %)
              </span>
            </span>
            <StatusChip
              status={lastPhysical.status === "ok" ? "ok" : lastPhysical.status}
              label={lastPhysical.status === "ok" ? "Dalam toleransi" : "Di luar toleransi"}
            />
          </div>
        ) : (
          <Empty>Belum ada hitung fisik tercatat.</Empty>
        )}
      </Card>
    </>
  );
}
