import Link from "next/link";
import { requireRole } from "@/lib/session";
import { loadLocations, viewerClient } from "@/lib/data";
import { addDays, computeFlockState, indexHdp, standardDailyKg, type ProjectionFlock } from "@winata/engine";
import { todayJakarta } from "@winata/db";
import type { DepletionRow, FlockRow, HouseRow, LocationRow } from "@winata/db";
import { Card, PageHead, Banner, Metric } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { ActionForm } from "@/components/ui/ActionForm";
import { DateInput, SelectInput, TextInput } from "@/components/ui/Inputs";
import { fmtDate, fmtKg, fmtNumber } from "@/lib/format";
import { saveDepletionAction, saveFlockAction } from "@/lib/actions/flock";
import { StatusChip } from "@/components/ui/StatusChip";

export const dynamic = "force-dynamic";

export default async function FlokPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const viewer = await requireRole(["manager", "accounting", "admin"]);
  const params = await searchParams;
  const editId = params.edit ?? null;
  const client = await viewerClient(viewer);
  const today = todayJakarta();

  const locations = await loadLocations(client, viewer);
  const locationIds = new Set(locations.map((location) => location.id));
  const houses = (((await client.from("house").select("*").is("deleted_at", null).order("code")).data as HouseRow[]) ?? []).filter(
    (house) => locationIds.has(house.location_id),
  );
  const flocks = (((await client.from("flock").select("*").is("deleted_at", null).order("code")).data as FlockRow[]) ?? []).filter(
    (flock) => houses.some((house) => house.id === flock.house_id),
  );
  const depletions = ((await client.from("flock_depletion").select("*").is("deleted_at", null).order("date", { ascending: false })).data as DepletionRow[]) ?? [];
  const hdpRows = ((await client
    .from("hdp_standard")
    .select("strain,age_week,hdp_pct,egg_weight_g")
    .is("deleted_at", null)).data as Array<{ strain: string; age_week: number; hdp_pct: string; egg_weight_g: string }>) ?? [];
  const series = indexHdp(
    hdpRows.map((row) => ({ strain: row.strain, ageWeek: Number(row.age_week), hdpPct: row.hdp_pct, eggWeightG: row.egg_weight_g })),
  );

  const houseById = new Map(houses.map((house) => [house.id, house]));
  const locationById = new Map(locations.map((location) => [location.id, location as LocationRow]));

  const houseIds = houses.map((house) => house.id);
  const productionWindowStart = addDays(today, -13);
  const production =
    houseIds.length > 0
      ? ((await client
          .from("production")
          .select("house_id,date,kg")
          .gte("date", productionWindowStart)
          .lte("date", today)
          .is("deleted_at", null)).data as Array<{ house_id: string; date: string; kg: string }>) ?? []
      : [];

  function flockInput(flock: FlockRow): ProjectionFlock {
    return {
      id: flock.id,
      houseId: flock.house_id,
      locationId: houseById.get(flock.house_id)?.location_id ?? "",
      code: flock.code,
      strain: flock.strain,
      chickInDate: flock.chick_in_date,
      initialBirds: flock.initial_birds,
      status: flock.status,
      productionStartDate: flock.production_start_date,
      cullDate: flock.cull_date,
      depletions: depletions.filter((row) => row.flock_id === flock.id).map((row) => ({ date: row.date, dead: row.dead, culled: row.culled })),
    };
  }

  const states = flocks.map((flock) => {
    const input = flockInput(flock);
    const state = computeFlockState(input, today, 18);
    const actual14 = production
      .filter((row) => row.house_id === flock.house_id)
      .reduce((acc, row) => acc + Number(row.kg), 0);
    let standard14 = 0;
    for (let index = 0; index < 14; index += 1) {
      standard14 += standardDailyKg(input, addDays(today, -index), series, 18).toNumber();
    }
    return { flock, input, state, actual14, standard14 };
  });

  const layerCount = states.filter((row) => row.state.status === "layer").length;
  const population = states.reduce((acc, row) => acc + row.state.population, 0);
  const editFlock = flocks.find((flock) => flock.id === editId);

  return (
    <>
      <PageHead
        title="Register flok"
        sub={`Umur, populasi, dan kurva aktual vs standar · ${fmtDate(today)}`}
      />

      <div className="grid grid-3">
        <Card title="Flok aktif">
          <Metric value={states.filter((row) => row.state.status !== "afkir").length} unit="flok" sub={`${layerCount} sedang berproduksi`} />
        </Card>
        <Card title="Populasi kini">
          <Metric value={fmtNumber(population, 0)} unit="ekor" sub="Awal − deplesi sampai hari ini" />
        </Card>
        <Card title="Rata-rata produksi aktual 14 hari">
          <Metric
            value={fmtKg(states.reduce((acc, row) => acc + row.actual14, 0) / 14, 1)}
            unit="kg/hari"
            sub="Semua kandang pada halaman ini"
          />
        </Card>
      </div>

      <Card title="Daftar flok" sub="Umur dihitung dari tanggal chick-in">
        <DataTable
          columns={[
            { key: "kode", label: "Kode" },
            { key: "kandang", label: "Kandang" },
            { key: "strain", label: "Strain" },
            { key: "umur", label: "Umur", numeric: true },
            { key: "populasi", label: "Populasi", numeric: true },
            { key: "status", label: "Status" },
            { key: "aktual", label: "Aktual 14h", numeric: true },
            { key: "standar", label: "Standar 14h", numeric: true },
            { key: "aksi", label: "" },
          ]}
          rows={states.map(({ flock, state, actual14, standard14 }) => ({
            __key: flock.id,
            kode: <strong>{flock.code}</strong>,
            kandang: houseById.get(flock.house_id)?.code ?? "—",
            strain: flock.strain,
            umur: `${state.ageWeeks} mgg`,
            populasi: fmtNumber(state.population, 0),
            status:
              state.status === "layer" ? (
                <StatusChip status="ok" label="Layer" />
              ) : state.status === "grower" ? (
                <StatusChip status="draft" label="Grower" />
              ) : (
                <StatusChip status="warn" label="Afkir" />
              ),
            aktual: fmtKg(actual14, 0),
            standar: standard14 > 0 ? fmtKg(standard14, 0) : "—",
            aksi: <Link href={`/flok?edit=${flock.id}`}>Ubah</Link>,
          }))}
          empty="Belum ada flok."
        />
      </Card>

      <div className="grid grid-2" style={{ marginTop: 12 }}>
        <Card title={editFlock ? `Ubah ${editFlock.code}` : "Tambah flok"} sub="Strain menentukan kurva standar.">
          <ActionForm action={saveFlockAction} submitLabel={editFlock ? "Simpan perubahan" : "Tambah flok"} resetOnSuccess={!editFlock}>
            {editFlock ? <input type="hidden" name="id" value={editFlock.id} /> : null}
            <div className="form-grid">
              <SelectInput
                name="house_id"
                label="Kandang"
                defaultValue={editFlock?.house_id}
                options={houses.map((house) => ({
                  value: house.id,
                  label: `${house.code} · ${locationById.get(house.location_id)?.code ?? ""}`,
                }))}
              />
              <TextInput name="code" label="Kode flok" required defaultValue={editFlock?.code ?? ""} />
              <SelectInput
                name="strain"
                label="Strain"
                defaultValue={editFlock?.strain ?? "Isa Brown"}
                options={[
                  { value: "Isa Brown", label: "Isa Brown" },
                  { value: "Lohmann Brown", label: "Lohmann Brown" },
                  { value: "Hy-Line Brown", label: "Hy-Line Brown" },
                ]}
              />
              <DateInput name="chick_in_date" label="Tanggal chick-in" required defaultValue={editFlock?.chick_in_date ?? today} />
              <TextInput name="initial_birds" label="Populasi awal" required defaultValue={String(editFlock?.initial_birds ?? "")} />
              <SelectInput
                name="status"
                label="Status"
                defaultValue={editFlock?.status ?? "grower"}
                options={[
                  { value: "grower", label: "Grower" },
                  { value: "layer", label: "Layer" },
                  { value: "afkir", label: "Afkir" },
                ]}
              />
              <DateInput
                name="production_start_date"
                label="Mulai produksi"
                defaultValue={editFlock?.production_start_date ?? ""}
              />
              <DateInput name="cull_date" label="Tanggal afkir" defaultValue={editFlock?.cull_date ?? ""} />
            </div>
          </ActionForm>
        </Card>

        <div className="stack">
          <Card title="Catat deplesi" sub="Mingguan minimal; harian bila ada. Tanggal yang sama dijumlahkan.">
            <ActionForm action={saveDepletionAction} submitLabel="Simpan deplesi" resetOnSuccess>
              <div className="form-grid">
                <SelectInput
                  name="flock_id"
                  label="Flok"
                  options={flocks.map((flock) => ({ value: flock.id, label: flock.code }))}
                />
                <DateInput name="date" label="Tanggal" defaultValue={today} required />
                <TextInput name="dead" label="Mati" defaultValue="0" />
                <TextInput name="culled" label="Afkir" defaultValue="0" />
                <div className="full">
                  <TextInput name="reason" label="Alasan" />
                </div>
              </div>
            </ActionForm>
          </Card>

          <Card title="Deplesi terakhir" sub="10 catatan terbaru">
            <DataTable
              columns={[
                { key: "tanggal", label: "Tanggal" },
                { key: "flok", label: "Flok" },
                { key: "mati", label: "Mati", numeric: true },
                { key: "afkir", label: "Afkir", numeric: true },
                { key: "alasan", label: "Alasan" },
              ]}
              rows={depletions.slice(0, 10).map((row) => ({
                __key: row.id,
                tanggal: fmtDate(row.date),
                flok: flocks.find((flock) => flock.id === row.flock_id)?.code ?? "—",
                mati: row.dead,
                afkir: row.culled,
                alasan: row.reason ?? "—",
              }))}
              empty="Belum ada deplesi."
            />
          </Card>
        </div>
      </div>

      <Banner tone="info">
        Umur minggu = ⌊(tanggal − chick-in) ÷ 7⌋. Status layer mulai tanggal mulai produksi atau umur 18 minggu bila kosong.
      </Banner>
    </>
  );
}
