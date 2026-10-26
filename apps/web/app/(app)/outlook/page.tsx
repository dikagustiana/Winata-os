import Link from "next/link";
import Decimal from "decimal.js";
import {
  addDays,
  cash13,
  computeFlockState,
  computeProjection,
  cullIndication,
  D,
  grossProfit,
  projectedRevenue,
  realizedPrice7,
  startOfWeek,
  weightedPriceByGradeDate,
} from "@winata/engine";
import { todayJakarta } from "@winata/db";
import type {
  CashBalanceRow,
  CashPlanRow,
  CustomerRow,
  DepletionRow,
  FlockRow,
  GradeRow,
  HouseRow,
  LocationRow,
  MarketPriceRow,
  OutboundLineRow,
  OutboundRow,
  ParameterRow,
  PositionDailyRow,
  ProjectionDailyRow,
  SalesPlanRow,
} from "@winata/db";
import { requireRole } from "@/lib/session";
import { param, paramNumber, viewerClient } from "@/lib/data";
import { fmtDate, fmtKg, fmtNumber, fmtRp, fmtRpJt } from "@/lib/format";
import { Card, PageHead, Banner, Metric, Empty } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { EstimateTag, StatusChip } from "@/components/ui/StatusChip";
import { Legend, Sparkline } from "@/components/ui/Charts";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "produksi", label: "Produksi 28 hari" },
  { key: "posisi", label: "Posisi proyeksi" },
  { key: "harga", label: "Harga & GP" },
  { key: "kas", label: "Kas 13 minggu" },
  { key: "afkir", label: "Afkir (indikatif)" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default async function OutlookPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const viewer = await requireRole(["bod", "marketing", "manager", "accounting", "admin"]);
  const params = await searchParams;
  const tab: TabKey = (TABS.find((item) => item.key === params.tab)?.key ?? "produksi") as TabKey;
  const client = await viewerClient(viewer);
  const today = todayJakarta();
  const tomorrow = addDays(today, 1);
  const horizon = 28;
  const end = addDays(today, horizon);

  const parameterRows = ((await client.from("parameter").select("key,value,valid_from").lte("valid_from", today).order("valid_from")).data as ParameterRow[]) ?? [];
  const parameters = new Map(parameterRows.map((row) => [row.key, row.value]));
  const hpp = D(paramNumber(parameters, "hpp_per_kg", 17419));
  const alertDays = paramNumber(parameters, "days_of_stock_alert", 5);
  const collectionProfile = param<Record<string, number[]>>(parameters, "collection_profile", {
    bakul: [1],
    agen: [0.5, 0.5],
    grup: [0, 0, 1],
    lain: [1],
  });

  const locations = ((await client.from("location").select("*").eq("active", true).order("code")).data as LocationRow[]) ?? [];
  const visibleLocations = viewer.role === "manager" ? locations.filter((location) => viewer.locationIds.includes(location.id)) : locations;
  const locationIds = new Set(visibleLocations.map((location) => location.id));
  const grades = ((await client.from("grade").select("*").eq("active", true).order("sort")).data as GradeRow[]) ?? [];
  const houses = ((await client.from("house").select("*").is("deleted_at", null)).data as HouseRow[]) ?? [];
  const flocks = ((await client.from("flock").select("*").is("deleted_at", null).order("code")).data as FlockRow[]) ?? [];
  const depletions = ((await client.from("flock_depletion").select("*").is("deleted_at", null)).data as DepletionRow[]) ?? [];
  const projections = ((await client
    .from("projection_daily")
    .select("*")
    .gte("date", tomorrow)
    .lte("date", end)
    .order("date")).data as ProjectionDailyRow[]) ?? [];
  const plans = ((await client
    .from("sales_plan")
    .select("*")
    .gte("date", today)
    .lte("date", end)
    .is("deleted_at", null)).data as SalesPlanRow[]) ?? [];
  const customers = ((await client.from("customer").select("*").is("deleted_at", null)).data as CustomerRow[]) ?? [];
  const outbounds = ((await client
    .from("outbound")
    .select("*")
    .gte("date", addDays(today, -30))
    .in("status", ["dikirim", "diterima"])
    .is("deleted_at", null)).data as OutboundRow[]) ?? [];
  const outboundIds = new Set(outbounds.map((row) => row.id));
  const outboundLines = ((await client.from("outbound_line").select("*").is("deleted_at", null)).data as OutboundLineRow[]) ?? [];
  const marketPrices = ((await client
    .from("market_price")
    .select("*")
    .gte("date", addDays(today, -30))
    .is("deleted_at", null)
    .order("date")).data as MarketPriceRow[]) ?? [];

  const houseById = new Map(houses.map((house) => [house.id, house]));

  const gradeById = new Map(grades.map((grade) => [grade.id, grade]));
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));

  const latestPosition = await client.from("position_daily").select("date").order("date", { ascending: false }).limit(1).maybeSingle();
  const positionDate = (latestPosition.data?.date as string | undefined) ?? today;
  const positions = ((await client.from("position_daily").select("*").eq("date", positionDate)).data as PositionDailyRow[]) ?? [];
  const visiblePositions = positions.filter((row) => {
    const location = visibleLocations.find((item) => item.id === row.location_id);
    return Boolean(location);
  });

  const productionHistory = ((await client
    .from("production")
    .select("house_id,date,kg,grade_id")
    .gte("date", addDays(today, -14))
    .lte("date", today)
    .is("deleted_at", null)).data as Array<{ house_id: string; date: string; kg: string; grade_id: string }>) ?? [];

  const realizedLines = outboundLines
    .filter((line) => outboundIds.has(line.outbound_id) && line.price_per_kg)
    .map((line) => {
      const outbound = outbounds.find((row) => row.id === line.outbound_id)!;
      return { date: outbound.date, gradeId: line.grade_id, kg: line.kg_delivered ?? line.kg_doc, pricePerKg: line.price_per_kg };
    });
  const priceByGrade7 = realizedPrice7(realizedLines, today);
  const weighted7Days = (() => {
    const recent = realizedLines.filter((line) => line.date >= addDays(today, -6));
    const kg = recent.reduce((acc, line) => acc.plus(line.kg), new Decimal(0));
    const rp = recent.reduce((acc, line) => acc.plus(D(line.kg).times(D(line.pricePerKg))), new Decimal(0));
    return kg.greaterThan(0) ? rp.dividedBy(kg) : new Decimal(0);
  })();

  // ---------------------------------------------------------------- Produksi
  const projectionDates = Array.from({ length: horizon }, (_, index) => addDays(tomorrow, index));
  const productionByDate = new Map<string, Decimal>();
  for (const row of projections) {
    if (!locationIds.has(houseById.get(row.house_id)?.location_id ?? "")) continue;
    productionByDate.set(row.date, (productionByDate.get(row.date) ?? new Decimal(0)).plus(row.kg_proj));
  }
  const actualByDate = new Map<string, Decimal>();
  for (const row of productionHistory) {
    if (!locationIds.has(houseById.get(row.house_id)?.location_id ?? "")) continue;
    actualByDate.set(row.date, (actualByDate.get(row.date) ?? new Decimal(0)).plus(row.kg));
  }
  const actualDates = Array.from({ length: 14 }, (_, index) => addDays(today, -13 + index));

  const flockStates = flocks
    .filter((flock) => {
      const house = houseById.get(flock.house_id);
      return house && locationIds.has(house.location_id) && flock.status !== "afkir";
    })
    .map((flock) => {
      const house = houseById.get(flock.house_id)!;
      const state = computeFlockState(
        {
          id: flock.id,
          code: flock.code,
          strain: flock.strain,
          chickInDate: flock.chick_in_date,
          initialBirds: flock.initial_birds,
          status: flock.status,
          productionStartDate: flock.production_start_date,
          cullDate: flock.cull_date,
          depletions: depletions.filter((row) => row.flock_id === flock.id).map((row) => ({ date: row.date, dead: row.dead, culled: row.culled })),
        },
        today,
      );
      const flockProjection = projections.filter((row) => row.flock_id === flock.id);
      const calibration = flockProjection[0]?.calibration_factor ?? null;
      const flag = flockProjection.find((row) => row.flag)?.flag ?? null;
      const total28 = flockProjection.reduce((acc, row) => acc.plus(row.kg_proj), new Decimal(0));
      const actual14 = productionHistory
        .filter((row) => row.house_id === flock.house_id)
        .reduce((acc, row) => acc.plus(row.kg), new Decimal(0));
      return { flock, house, state, calibration, flag, total28, actual14, projection: flockProjection };
    });

  // ---------------------------------------------------------------- Posisi
  const projectedProduction = projections
    .filter((row) => locationIds.has(houseById.get(row.house_id)?.location_id ?? ""))
    .map((row) => ({
      locationId: houseById.get(row.house_id)!.location_id,
      gradeId: row.grade_id,
      date: row.date,
      kg: row.kg_proj,
    }));
  const projectionRows = computeProjection({
    startDate: tomorrow,
    days: horizon,
    baseStock: visiblePositions.map((row) => ({ locationId: row.location_id, gradeId: row.grade_id, closing: row.closing })),
    production: projectedProduction,
    plans: plans.map((plan) => ({
      customerId: plan.customer_id,
      kind: plan.kind,
      date: plan.date,
      gradeId: plan.grade_id,
      kg: plan.kg,
      pricePerKg: plan.price_per_kg,
    })),
    alertDays,
  });
  const projectionByDateGrade = new Map<string, { closing: Decimal; shortage: boolean; over: boolean }>();
  for (const row of projectionRows) {
    const key = `${row.date}|${row.gradeId}`;
    const current = projectionByDateGrade.get(key) ?? { closing: new Decimal(0), shortage: false, over: false };
    current.closing = current.closing.plus(row.closingProj);
    current.shortage = current.shortage || row.shortage;
    current.over = current.over || row.overAlert;
    projectionByDateGrade.set(key, current);
  }

  // ---------------------------------------------------------------- Harga & GP
  const priceRows = weightedPriceByGradeDate(realizedLines);
  const fourWeeksEnd = addDays(today, 28);
  const planRevenue = projectedRevenue(
    plans.filter((plan) => plan.date <= fourWeeksEnd).map((plan) => ({
      gradeId: plan.grade_id,
      kg: plan.kg,
      pricePerKg: plan.price_per_kg,
    })),
    priceByGrade7,
  );
  const planGp = grossProfit(planRevenue.revenueRp, planRevenue.kg, hpp);
  const revenueByGrade = new Map<string, { kg: Decimal; rp: Decimal }>();
  for (const plan of plans.filter((item) => item.date <= fourWeeksEnd)) {
    const price = plan.price_per_kg ? D(plan.price_per_kg) : priceByGrade7.get(plan.grade_id) ?? new Decimal(0);
    const current = revenueByGrade.get(plan.grade_id) ?? { kg: new Decimal(0), rp: new Decimal(0) };
    current.kg = current.kg.plus(plan.kg);
    current.rp = current.rp.plus(D(plan.kg).times(price));
    revenueByGrade.set(plan.grade_id, current);
  }
  const priceDates = Array.from(new Set([...marketPrices.map((row) => row.date), ...Array.from(new Set(realizedLines.map((line) => line.date)))])).sort();
  const marketSeries = priceDates.map((date) => {
    const rows = marketPrices.filter((row) => row.date === date);
    if (rows.length === 0) return 0;
    return rows.reduce((acc, row) => acc + Number(row.price_per_kg), 0) / rows.length;
  });
  const realizedDaily = priceDates.map((date) => {
    const lines = realizedLines.filter((line) => line.date === date);
    const kg = lines.reduce((acc, line) => acc.plus(line.kg), new Decimal(0));
    const rp = lines.reduce((acc, line) => acc.plus(D(line.kg).times(D(line.pricePerKg))), new Decimal(0));
    return kg.greaterThan(0) ? rp.dividedBy(kg).toNumber() : 0;
  });

  // ---------------------------------------------------------------- Kas
  const cashBalance = ((await client
    .from("cash_balance")
    .select("*")
    .lte("as_of", today)
    .is("deleted_at", null)
    .order("as_of", { ascending: false })
    .limit(1)).data as CashBalanceRow[]) ?? [];
  const cashPlan = ((await client
    .from("cash_plan")
    .select("*")
    .gte("week_start", addDays(today, -14))
    .lte("week_start", addDays(today, 13 * 7 + 14))
    .is("deleted_at", null)).data as CashPlanRow[]) ?? [];
  const startWeek = startOfWeek(today);
  const revenueWeeks: Array<{ weekStart: string; customerKind: string; amountRp: string }> = [];
  for (const plan of plans) {
    const customer = customerById.get(plan.customer_id);
    const price = plan.price_per_kg ? D(plan.price_per_kg) : priceByGrade7.get(plan.grade_id) ?? new Decimal(0);
    revenueWeeks.push({
      weekStart: startOfWeek(plan.date),
      customerKind: customer?.kind ?? "lain",
      amountRp: D(plan.kg).times(price).toFixed(2),
    });
  }
  const cashResult = cash13({
    startWeek,
    startBalance: cashBalance[0]?.amount_rp ?? "0",
    revenue: revenueWeeks,
    cashPlan: cashPlan.map((row) => ({
      weekStart: row.week_start,
      category: row.category,
      direction: row.direction,
      amountRp: row.amount_rp,
    })),
    profile: collectionProfile,
    weeks: 13,
  });

  // ---------------------------------------------------------------- Afkir
  const cullRows = flockStates
    .filter((row) => row.state.status === "layer")
    .map((row) => {
      const nextSeven = Array.from({ length: 7 }, (_, index) => addDays(today, index + 1));
      const dailyProjection = nextSeven
        .map((date) => row.projection.filter((cell) => cell.date === date).reduce((acc, cell) => acc.plus(cell.kg_proj), new Decimal(0)))
        .reduce((acc, value) => acc.plus(value), new Decimal(0))
        .dividedBy(7);
      const result = cullIndication({
        population: row.state.population,
        productionKgDaily: dailyProjection.toFixed(3),
        realizedPricePerKg: weighted7Days.toFixed(2),
        feedGPerBird: paramNumber(parameters, "feed_g_per_bird", 115),
        feedPricePerKg: paramNumber(parameters, "feed_price_per_kg", 7100),
        cullValuePerBird: paramNumber(parameters, "cull_value_per_bird", 35000),
        remainingDays: 28,
      });
      return { row, dailyProjection, result };
    });

  const productionSeries = projectionDates.map((date) => (productionByDate.get(date) ?? new Decimal(0)).toNumber());
  const actualSeries = actualDates.map((date) => (actualByDate.get(date) ?? new Decimal(0)).toNumber());

  return (
    <>
      <PageHead
        title="Outlook"
        sub={`${fmtDate(today)} · proyeksi 28 hari · HPP sementara Rp ${fmtNumber(hpp, 0)}/kg`}
        actions={<EstimateTag />}
      />
      <nav className="tabs" aria-label="Outlook">
        {TABS.map((item) => (
          <Link key={item.key} href={`/outlook?tab=${item.key}`} aria-current={tab === item.key ? "page" : undefined}>
            {item.label}
          </Link>
        ))}
      </nav>

      {projections.length === 0 ? (
        <Banner tone="warn">
          Proyeksi belum dihitung. Proyeksi dibangun worker setelah ada register flok dan produksi aktual.
        </Banner>
      ) : null}

      {tab === "produksi" ? (
        <>
          <div className="grid grid-3">
            <Card title="Proyeksi 28 hari">
              <Metric
                value={fmtKg(productionSeries.reduce((acc, value) => acc + value, 0), 0)}
                unit="kg"
                sub={`Rata-rata ${fmtKg(productionSeries.reduce((acc, value) => acc + value, 0) / 28, 0)} kg/hari`}
              />
            </Card>
            <Card title="Aktual 14 hari">
              <Metric value={fmtKg(actualSeries.reduce((acc, value) => acc + value, 0), 0)} unit="kg" sub="Produksi tercatat" />
            </Card>
            <Card title="Flok berproduksi">
              <Metric value={flockStates.filter((row) => row.state.isProducing).length} unit="flok" sub={`${flockStates.length} flok aktif`} />
            </Card>
          </div>

          <Card title="Proyeksi vs aktual" sub="Aktual 14 hari terakhir; proyeksi 28 hari ke depan">
            <Legend
              items={[
                { label: "Proyeksi", color: "var(--accent)" },
                { label: "Aktual", color: "var(--approved)" },
              ]}
            />
            <Sparkline
              series={[
                { label: "Proyeksi", color: "var(--accent)", points: productionSeries },
                { label: "Aktual", color: "var(--approved)", points: actualSeries },
              ]}
              ariaLabel="Garis proyeksi dan aktual produksi"
            />
          </Card>

          <Card title="Per flok" sub="Faktor kalibrasi = Σ aktual 14 hari ÷ Σ standar 14 hari (0,6–1,2)">
            <DataTable
              columns={[
                { key: "kode", label: "Flok" },
                { key: "kandang", label: "Kandang" },
                { key: "strain", label: "Strain" },
                { key: "umur", label: "Umur", numeric: true },
                { key: "populasi", label: "Populasi", numeric: true },
                { key: "kalibrasi", label: "Kalibrasi", numeric: true },
                { key: "aktual", label: "Aktual 14h kg", numeric: true },
                { key: "proyeksi", label: "Proyeksi 28h kg", numeric: true },
                { key: "status", label: "Status" },
              ]}
              rows={flockStates.map(({ flock, house, state, calibration, flag, total28, actual14 }) => ({
                __key: flock.id,
                kode: <strong>{flock.code}</strong>,
                kandang: house.code,
                strain: flock.strain,
                umur: `${state.ageWeeks} mgg`,
                populasi: fmtNumber(state.population, 0),
                kalibrasi: calibration ? Number(calibration).toFixed(3) : "—",
                aktual: fmtKg(actual14, 0),
                proyeksi: fmtKg(total28, 0),
                status: flag === "insufficient_calibration" ? (
                  <StatusChip status="estimate" label="Kalibrasi belum cukup" />
                ) : state.isProducing ? (
                  <StatusChip status="ok" label="Layer" />
                ) : (
                  <StatusChip status="draft" label="Grower" />
                ),
              }))}
              empty="Belum ada flok."
            />
          </Card>
        </>
      ) : null}

      {tab === "posisi" ? (
        <Card title="Posisi proyeksi per grade" sub="Merah: kekurangan pasok terhadap order · Kuning: di atas ambang hari stok">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="sticky-col">Tanggal</th>
                  {grades.map((grade) => (
                    <th key={grade.id} className="num">{grade.code}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {projectionDates.map((date) => (
                  <tr key={date}>
                    <td className="sticky-col">{fmtDate(date)}</td>
                    {grades.map((grade) => {
                      const cell = projectionByDateGrade.get(`${date}|${grade.id}`);
                      const value = cell?.closing ?? new Decimal(0);
                      return (
                        <td key={grade.id} className={`num ${cell?.shortage ? "negative" : ""}`} title={cell?.shortage ? "Kekurangan pasok" : cell?.over ? "Di atas ambang hari stok" : undefined}>
                          {cell ? fmtKg(value, 0) : "—"}
                          {cell?.over && !cell.shortage ? <div className="small" style={{ color: "var(--warn-ink)" }}>di atas ambang</div> : null}
                          {cell?.shortage ? <div className="small">kekurangan</div> : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>
            Posisi proyeksi = stok hari ini + produksi proyeksi − order − forecast. Rencana jual tanpa lokasi dialokasikan
            proporsional terhadap stok grade.
          </p>
        </Card>
      ) : null}

      {tab === "harga" ? (
        <>
          <div className="grid grid-2">
            <Card title="Pendapatan & GP 4 minggu" sub="HPP sementara">
              <Metric value={fmtRpJt(planRevenue.revenueRp)} sub={`GP ${fmtRpJt(planGp)} dari ${fmtKg(planRevenue.kg, 0)} kg`} />
              <div className="divider" />
              <DataTable
                columns={[
                  { key: "grade", label: "Grade" },
                  { key: "kg", label: "Kg", numeric: true },
                  { key: "rp", label: "Pendapatan", numeric: true },
                  { key: "gp", label: "GP", numeric: true },
                ]}
                rows={Array.from(revenueByGrade.entries()).map(([gradeId, value]) => ({
                  __key: gradeId,
                  grade: gradeById.get(gradeId)?.code ?? "—",
                  kg: fmtKg(value.kg, 0),
                  rp: fmtRpJt(value.rp),
                  gp: fmtRpJt(value.rp.minus(value.kg.times(hpp))),
                }))}
                empty="Belum ada rencana jual."
              />
            </Card>
            <Card title="Harga realisasi vs acuan" sub="30 hari terakhir">
              <Legend
                items={[
                  { label: "Realisasi", color: "var(--accent)" },
                  { label: "Acuan", color: "var(--warn)" },
                ]}
              />
              <Sparkline
                series={[
                  { label: "Realisasi", color: "var(--accent)", points: realizedDaily },
                  { label: "Acuan", color: "var(--warn)", points: marketSeries },
                ]}
                ariaLabel="Harga realisasi dan acuan 30 hari"
              />
              <div className="divider" />
              <div className="small muted">Harga realisasi tertimbang 7 hari: {fmtRp(weighted7Days)}/kg</div>
            </Card>
          </div>

          <Card title="Harga realisasi tertimbang per grade per hari" sub="Dari DO dikirim/diterima">
            <DataTable
              columns={[
                { key: "tanggal", label: "Tanggal" },
                { key: "grade", label: "Grade" },
                { key: "harga", label: "Harga/kg", numeric: true },
              ]}
              rows={Array.from(priceRows.entries())
                .sort((a, b) => (a[0] < b[0] ? 1 : -1))
                .slice(0, 30)
                .map(([key, price]) => {
                  const [date, gradeId] = key.split("|");
                  return { __key: key, tanggal: fmtDate(date), grade: gradeById.get(gradeId)?.code ?? "—", harga: fmtRp(price) };
                })}
              empty="Belum ada harga realisasi."
            />
          </Card>
        </>
      ) : null}

      {tab === "kas" ? (
        <>
          <div className="grid grid-3">
            <Card title="Saldo awal">
              <Metric value={fmtRpJt(cashBalance[0]?.amount_rp ?? 0)} sub={cashBalance[0] ? fmtDate(cashBalance[0].as_of) : "Belum diisi"} />
            </Card>
            <Card title="Saldo terendah 13 minggu">
              <Metric
                value={fmtRpJt(cashResult.lowest.balance)}
                negative={Number(cashResult.lowest.balance) < 0}
                sub={fmtDate(cashResult.lowest.weekStart)}
              />
            </Card>
            <Card title="Total penagihan 13 minggu">
              <Metric value={fmtRpJt(cashResult.weeks.reduce((acc, week) => acc + Number(week.collectionIn), 0))} sub="Profil penagihan per jenis pelanggan" />
            </Card>
          </div>
          <Card title="Kas 13 minggu" sub="Masuk = penagihan + rencana masuk; keluar = rencana kas">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th className="sticky-col">Minggu</th>
                    <th className="num">Penagihan</th>
                    <th className="num">Masuk lain</th>
                    <th className="num">Keluar</th>
                    <th className="num">Net</th>
                    <th className="num">Saldo akhir</th>
                  </tr>
                </thead>
                <tbody>
                  {cashResult.weeks.map((week) => (
                    <tr key={week.weekStart} className={week.weekStart === cashResult.lowest.weekStart ? "total-row" : undefined}>
                      <td className="sticky-col">{fmtDate(week.weekStart)}</td>
                      <td className="num">{fmtRpJt(week.collectionIn)}</td>
                      <td className="num">{fmtRpJt(week.otherIn)}</td>
                      <td className="num">{fmtRpJt(week.outflow)}</td>
                      <td className="num">{fmtRpJt(week.net)}</td>
                      <td className={`num ${Number(week.ending) < 0 ? "negative" : ""}`}>{fmtRpJt(week.ending)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small muted" style={{ marginTop: 8 }}>
              Baris tebal = saldo terendah. Input saldo awal dan rencana kas di <Link href="/rekon">Rekon & kunci → Kas</Link>.
            </p>
          </Card>
        </>
      ) : null}

      {tab === "afkir" ? (
        <Card title="Afkir indikatif" sub="Margin harian vs nilai afkir; indikatif dan belum costing flok">
          {cullRows.length === 0 ? (
            <Empty>Belum ada flok layer.</Empty>
          ) : (
            <DataTable
              columns={[
                { key: "flok", label: "Flok" },
                { key: "umur", label: "Umur", numeric: true },
                { key: "populasi", label: "Populasi", numeric: true },
                { key: "produksi", label: "Proyeksi kg/hari", numeric: true },
                { key: "margin", label: "Margin Rp/hari", numeric: true },
                { key: "ambang", label: "Ambang afkir", numeric: true },
                { key: "rasio", label: "Rasio", numeric: true },
                { key: "indikasi", label: "Indikasi" },
              ]}
              rows={cullRows.map(({ row, dailyProjection, result }) => ({
                __key: row.flock.id,
                flok: <strong>{row.flock.code}</strong>,
                umur: `${row.state.ageWeeks} mgg`,
                populasi: fmtNumber(row.state.population, 0),
                produksi: fmtKg(dailyProjection, 1),
                margin: fmtRp(result.marginDailyRp),
                ambang: fmtRp(result.thresholdRp),
                rasio: result.ratio ? fmtNumber(result.ratio, 2) : "—",
                indikasi: (
                  <StatusChip
                    status={result.suggestion === "lanjut" ? "ok" : "warn"}
                    label={result.suggestion === "lanjut" ? "Lanjut" : "Tinjau"}
                  />
                ),
              }))}
            />
          )}
          <p className="small muted" style={{ marginTop: 8 }}>
            Margin = produksi proyeksi × harga realisasi − populasi × pakan g/ekor/hari × harga pakan. Ambang = nilai
            afkir/ekor × populasi ÷ sisa hari rencana. <EstimateTag>Indikatif</EstimateTag>
          </p>
          {weighted7Days.isZero() ? <Banner tone="warn">Harga realisasi 7 hari belum ada; indikasi afkir belum bermakna.</Banner> : null}
        </Card>
      ) : null}
    </>
  );
}
