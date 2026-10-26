import Link from "next/link";
import { requireRole } from "@/lib/session";
import { loadLocations, viewerClient } from "@/lib/data";
import { todayJakarta } from "@winata/db";
import type { ConversionRow, CustomerRow, GradeRow, HouseRow } from "@winata/db";
import { PageHead, Card, Banner } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { ActionForm } from "@/components/ui/ActionForm";
import { DateInput, SelectInput, TextInput } from "@/components/ui/Inputs";
import { fmtDate, fmtKg } from "@/lib/format";
import {
  saveConversionAction,
  saveCustomerAction,
  saveGradeAction,
  saveHouseAction,
  saveLocationAction,
} from "@/lib/actions/master";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "lokasi", label: "Lokasi" },
  { key: "kandang", label: "Kandang" },
  { key: "grade", label: "Grade" },
  { key: "konversi", label: "Konversi satuan" },
  { key: "pelanggan", label: "Pelanggan" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default async function MasterPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; edit?: string }>;
}) {
  const viewer = await requireRole(["accounting", "admin"]);
  const params = await searchParams;
  const tab: TabKey = (TABS.find((t) => t.key === params.tab)?.key ?? "lokasi") as TabKey;
  const editId = params.edit ?? null;
  const client = await viewerClient(viewer);
  const today = todayJakarta();

  const locations = await loadLocations(client, viewer);
  const houses = ((await client.from("house").select("*").is("deleted_at", null).order("code")).data as HouseRow[]) ?? [];
  const grades = ((await client.from("grade").select("*").is("deleted_at", null).order("sort")).data as GradeRow[]) ?? [];
  const conversions =
    ((await client
      .from("unit_conversion")
      .select("id,grade_id,valid_from,kg_per_crate,kg_per_tray,eggs_per_kg,source")
      .is("deleted_at", null)
      .order("valid_from", { ascending: false })).data as ConversionRow[]) ?? [];
  const customers = ((await client.from("customer").select("*").is("deleted_at", null).order("name")).data as CustomerRow[]) ?? [];

  const locationById = new Map(locations.map((row) => [row.id, row]));
  const gradeById = new Map(grades.map((row) => [row.id, row]));

  function tabLink(key: TabKey) {
    return `/master?tab=${key}`;
  }

  return (
    <>
      <PageHead
        title="Master data"
        sub="Perubahan tercatat di audit dengan nilai lama dan baru."
        actions={<Link href="/admin" className="btn btn-sm">Pengguna & parameter</Link>}
      />
      <nav className="tabs" aria-label="Master data">
        {TABS.map((item) => (
          <Link key={item.key} href={tabLink(item.key)} aria-current={tab === item.key ? "page" : undefined}>
            {item.label}
          </Link>
        ))}
      </nav>

      {tab === "lokasi" ? (
        <div className="grid grid-2">
          <Card title="Lokasi" sub={`${locations.length} aktif`}>
            <DataTable
              columns={[
                { key: "kode", label: "Kode" },
                { key: "nama", label: "Nama" },
                { key: "jenis", label: "Jenis" },
                { key: "aksi", label: "" },
              ]}
              rows={locations.map((row) => ({
                __key: row.id,
                kode: <strong>{row.code}</strong>,
                nama: row.name,
                jenis: row.kind === "kandang" ? "Kandang" : "Gudang",
                aksi: <Link href={`/master?tab=lokasi&edit=${row.id}`}>Ubah</Link>,
              }))}
            />
          </Card>
          <Card
            title={editId ? "Ubah lokasi" : "Tambah lokasi"}
            sub="Kode dipakai di nomor DO dan laporan."
          >
            <ActionForm action={saveLocationAction} submitLabel={editId ? "Simpan perubahan" : "Tambah lokasi"} resetOnSuccess={!editId}>
              {editId ? <input type="hidden" name="id" value={editId} /> : null}
              <div className="form-grid">
                <TextInput name="code" label="Kode" required defaultValue={locations.find((l) => l.id === editId)?.code ?? ""} />
                <TextInput name="name" label="Nama" required defaultValue={locations.find((l) => l.id === editId)?.name ?? ""} />
                <SelectInput
                  name="kind"
                  label="Jenis"
                  defaultValue={locations.find((l) => l.id === editId)?.kind ?? "kandang"}
                  options={[
                    { value: "kandang", label: "Kandang" },
                    { value: "gudang", label: "Gudang" },
                  ]}
                />
                <label className="inline small" style={{ alignSelf: "end", minHeight: 44 }}>
                  <input type="checkbox" name="active" defaultChecked /> Aktif
                </label>
              </div>
            </ActionForm>
          </Card>
        </div>
      ) : null}

      {tab === "kandang" ? (
        <div className="grid grid-2">
          <Card title="Kandang" sub="Jumlah kandang per lokasi">
            <DataTable
              columns={[
                { key: "kode", label: "Kode" },
                { key: "nama", label: "Nama" },
                { key: "lokasi", label: "Lokasi" },
                { key: "kapasitas", label: "Kapasitas", numeric: true },
                { key: "aksi", label: "" },
              ]}
              rows={houses.map((row) => ({
                __key: row.id,
                kode: <strong>{row.code}</strong>,
                nama: row.name,
                lokasi: locationById.get(row.location_id)?.code ?? "—",
                kapasitas: row.capacity_birds ? row.capacity_birds.toLocaleString("id-ID") : "—",
                aksi: <Link href={`/master?tab=kandang&edit=${row.id}`}>Ubah</Link>,
              }))}
            />
          </Card>
          <Card title={editId ? "Ubah kandang" : "Tambah kandang"}>
            <ActionForm action={saveHouseAction} submitLabel={editId ? "Simpan perubahan" : "Tambah kandang"} resetOnSuccess={!editId}>
              {editId ? <input type="hidden" name="id" value={editId} /> : null}
              <div className="form-grid">
                <SelectInput
                  name="location_id"
                  label="Lokasi"
                  defaultValue={houses.find((h) => h.id === editId)?.location_id}
                  options={locations.map((location) => ({ value: location.id, label: `${location.code} · ${location.name}` }))}
                />
                <TextInput name="code" label="Kode kandang" required defaultValue={houses.find((h) => h.id === editId)?.code ?? ""} />
                <TextInput name="name" label="Nama" required defaultValue={houses.find((h) => h.id === editId)?.name ?? ""} />
                <TextInput name="capacity_birds" label="Kapasitas (ekor)" defaultValue={String(houses.find((h) => h.id === editId)?.capacity_birds ?? "")} />
                <label className="inline small" style={{ alignSelf: "end", minHeight: 44 }}>
                  <input type="checkbox" name="active" defaultChecked /> Aktif
                </label>
              </div>
            </ActionForm>
          </Card>
        </div>
      ) : null}

      {tab === "grade" ? (
        <div className="grid grid-2">
          <Card title="Grade" sub="UB, US, UK, RT, PC">
            <DataTable
              columns={[
                { key: "kode", label: "Kode" },
                { key: "nama", label: "Nama" },
                { key: "urutan", label: "Urutan", numeric: true },
                { key: "jual", label: "Dijual" },
                { key: "aksi", label: "" },
              ]}
              rows={grades.map((row) => ({
                __key: row.id,
                kode: <strong>{row.code}</strong>,
                nama: row.name,
                urutan: row.sort,
                jual: row.is_saleable ? "Ya" : "Tidak",
                aksi: <Link href={`/master?tab=grade&edit=${row.id}`}>Ubah</Link>,
              }))}
            />
          </Card>
          <Card title={editId ? "Ubah grade" : "Tambah grade"}>
            <ActionForm action={saveGradeAction} submitLabel={editId ? "Simpan perubahan" : "Tambah grade"} resetOnSuccess={!editId}>
              {editId ? <input type="hidden" name="id" value={editId} /> : null}
              <div className="form-grid">
                <TextInput name="code" label="Kode" required defaultValue={grades.find((g) => g.id === editId)?.code ?? ""} />
                <TextInput name="name" label="Nama" required defaultValue={grades.find((g) => g.id === editId)?.name ?? ""} />
                <TextInput name="sort" label="Urutan" defaultValue={String(grades.find((g) => g.id === editId)?.sort ?? grades.length + 1)} />
                <label className="inline small" style={{ alignSelf: "end", minHeight: 44 }}>
                  <input type="checkbox" name="is_saleable" defaultChecked={grades.find((g) => g.id === editId)?.is_saleable ?? true} /> Bisa dijual
                </label>
                <label className="inline small" style={{ minHeight: 44 }}>
                  <input type="checkbox" name="active" defaultChecked /> Aktif
                </label>
              </div>
            </ActionForm>
          </Card>
        </div>
      ) : null}

      {tab === "konversi" ? (
        <div className="grid grid-2">
          <Card title="Versi konversi" sub="Satuan dasar kg; versi berlaku per tanggal">
            <DataTable
              columns={[
                { key: "grade", label: "Grade" },
                { key: "dari", label: "Berlaku" },
                { key: "peti", label: "kg/peti", numeric: true },
                { key: "tray", label: "kg/tray", numeric: true },
                { key: "butir", label: "butir/kg", numeric: true },
                { key: "sumber", label: "Sumber" },
              ]}
              rows={conversions.map((row) => ({
                __key: row.id,
                grade: gradeById.get(row.grade_id)?.code ?? "—",
                dari: fmtDate(row.valid_from),
                peti: row.kg_per_crate ? fmtKg(row.kg_per_crate, 2) : "—",
                tray: row.kg_per_tray ? fmtKg(row.kg_per_tray, 2) : "—",
                butir: row.eggs_per_kg ? fmtKg(row.eggs_per_kg, 1) : "—",
                sumber: row.source,
              }))}
            />
          </Card>
          <Card title="Tambah versi konversi" sub="Nilai baru tidak mengubah transaksi lama">
            <ActionForm action={saveConversionAction} submitLabel="Simpan versi" resetOnSuccess>
              <div className="form-grid">
                <SelectInput
                  name="grade_id"
                  label="Grade"
                  options={grades.map((grade) => ({ value: grade.id, label: `${grade.code} · ${grade.name}` }))}
                />
                <DateInput name="valid_from" label="Berlaku dari" defaultValue={today} required />
                <TextInput name="kg_per_crate" label="Kg per peti" />
                <TextInput name="kg_per_tray" label="Kg per tray" />
                <TextInput name="eggs_per_kg" label="Butir per kg" />
                <SelectInput
                  name="source"
                  label="Sumber"
                  options={[
                    { value: "manual", label: "Manual" },
                    { value: "opname", label: "Opname" },
                    { value: "fisik", label: "Hitung fisik" },
                  ]}
                />
              </div>
            </ActionForm>
          </Card>
        </div>
      ) : null}

      {tab === "pelanggan" ? (
        <div className="grid grid-2">
          <Card title="Pelanggan" sub="Entitas grup berelasi ditandai">
            <DataTable
              columns={[
                { key: "kode", label: "Kode" },
                { key: "nama", label: "Nama" },
                { key: "jenis", label: "Jenis" },
                { key: "relasi", label: "Berelasi" },
                { key: "termin", label: "Termin", numeric: true },
                { key: "aksi", label: "" },
              ]}
              rows={customers.map((row) => ({
                __key: row.id,
                kode: <strong>{row.code}</strong>,
                nama: row.name,
                jenis: row.kind,
                relasi: row.is_related_party ? "Ya" : "—",
                termin: `${row.payment_terms_days} hari`,
                aksi: <Link href={`/master?tab=pelanggan&edit=${row.id}`}>Ubah</Link>,
              }))}
            />
          </Card>
          <Card title={editId ? "Ubah pelanggan" : "Tambah pelanggan"}>
            <ActionForm action={saveCustomerAction} submitLabel={editId ? "Simpan perubahan" : "Tambah pelanggan"} resetOnSuccess={!editId}>
              {editId ? <input type="hidden" name="id" value={editId} /> : null}
              <div className="form-grid">
                <TextInput name="code" label="Kode" required defaultValue={customers.find((c) => c.id === editId)?.code ?? ""} />
                <TextInput name="name" label="Nama" required defaultValue={customers.find((c) => c.id === editId)?.name ?? ""} />
                <SelectInput
                  name="kind"
                  label="Jenis"
                  defaultValue={customers.find((c) => c.id === editId)?.kind ?? "bakul"}
                  options={[
                    { value: "bakul", label: "Bakul" },
                    { value: "agen", label: "Agen" },
                    { value: "grup", label: "Grup" },
                    { value: "lain", label: "Lain" },
                  ]}
                />
                <TextInput
                  name="payment_terms_days"
                  label="Termin (hari)"
                  defaultValue={String(customers.find((c) => c.id === editId)?.payment_terms_days ?? 0)}
                />
                <label className="inline small" style={{ alignSelf: "end", minHeight: 44 }}>
                  <input type="checkbox" name="is_related_party" defaultChecked={customers.find((c) => c.id === editId)?.is_related_party ?? false} />{" "}
                  Pihak berelasi
                </label>
              </div>
            </ActionForm>
          </Card>
        </div>
      ) : null}

      <Banner tone="info">
        Semua perubahan master di-audit otomatis. Kode yang dihapus tidak ditampilkan (soft delete), bukan dihapus permanen.
      </Banner>
    </>
  );
}
