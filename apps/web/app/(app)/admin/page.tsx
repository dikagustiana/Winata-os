import Link from "next/link";
import { requireRole } from "@/lib/session";
import { loadLocations, viewerClient } from "@/lib/data";
import type { ParameterRow, ProfileRow, UserLocationRow } from "@winata/db";
import { todayJakarta } from "@winata/db";
import { Card, PageHead, Banner } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { ActionForm } from "@/components/ui/ActionForm";
import { SelectInput, TextInput } from "@/components/ui/Inputs";
import { fmtDateTime } from "@/lib/format";
import { assignLocationsAction, createUserAction, setPasswordAction, updateUserAction } from "@/lib/actions/admin";
import { saveParameterAction } from "@/lib/actions/master";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "pengguna", label: "Pengguna" },
  { key: "penugasan", label: "Penugasan lokasi" },
  { key: "parameter", label: "Parameter" },
  { key: "audit", label: "Audit" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

interface AuditRow {
  id: number;
  table_name: string;
  action: string;
  actor_email: string | null;
  at: Date | string;
  old: Record<string, unknown> | null;
  new: Record<string, unknown> | null;
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; edit?: string; user?: string }>;
}) {
  const viewer = await requireRole(["admin"]);
  const params = await searchParams;
  const tab: TabKey = (TABS.find((t) => t.key === params.tab)?.key ?? "pengguna") as TabKey;
  const client = await viewerClient(viewer);
  const today = todayJakarta();

  const users = ((await client.from("app_user").select("id,email,name,role,active").is("deleted_at", null).order("email")).data as ProfileRow[]) ?? [];
  const locations = await loadLocations(client, viewer);
  const assignments = ((await client.from("user_location").select("user_id,location_id")).data as UserLocationRow[]) ?? [];
  const parameters = ((await client.from("parameter").select("*").is("deleted_at", null).order("key")).data as ParameterRow[]) ?? [];
  const audit = ((await client.from("audit_log").select("*").order("id", { ascending: false }).limit(50)).data as AuditRow[]) ?? [];

  const editUser = users.find((u) => u.id === params.edit);
  const selectedUser = users.find((u) => u.id === params.user) ?? users[0];
  const assignedIds = new Set(assignments.filter((row) => row.user_id === selectedUser?.id).map((row) => row.location_id));
  const edits = new URLSearchParams();
  if (params.tab) edits.set("tab", params.tab);

  return (
    <>
      <PageHead title="Admin" sub="Pengguna, peran, penugasan lokasi, parameter, dan audit." />
      <nav className="tabs" aria-label="Admin">
        {TABS.map((item) => (
          <Link key={item.key} href={`/admin?tab=${item.key}`} aria-current={tab === item.key ? "page" : undefined}>
            {item.label}
          </Link>
        ))}
      </nav>

      {tab === "pengguna" ? (
        <div className="grid grid-2">
          <Card title="Pengguna" sub={`${users.length} akun`}>
            <DataTable
              columns={[
                { key: "nama", label: "Nama" },
                { key: "email", label: "E-mail" },
                { key: "peran", label: "Peran" },
                { key: "aktif", label: "Aktif" },
                { key: "aksi", label: "" },
              ]}
              rows={users.map((row) => ({
                __key: row.id,
                nama: row.name,
                email: row.email,
                peran: row.role,
                aktif: row.active ? "Ya" : "Tidak",
                aksi: <Link href={`/admin?tab=pengguna&edit=${row.id}`}>Ubah</Link>,
              }))}
            />
          </Card>
          <div className="stack">
            <Card title="Tambah pengguna" sub="Hanya e-mail yang ada di sini yang bisa masuk.">
              <ActionForm action={createUserAction} submitLabel="Buat akun" resetOnSuccess>
                <div className="form-grid">
                  <TextInput name="email" label="E-mail" type="email" required autoComplete="off" />
                  <TextInput name="name" label="Nama" required />
                  <SelectInput
                    name="role"
                    label="Peran"
                    options={[
                      { value: "kandang", label: "Kandang" },
                      { value: "manager", label: "Manager" },
                      { value: "accounting", label: "Accounting" },
                      { value: "marketing", label: "Marketing" },
                      { value: "bod", label: "Direksi" },
                      { value: "admin", label: "Admin" },
                    ]}
                  />
                  <TextInput name="password" label="Kata sandi awal" type="password" required autoComplete="new-password" />
                </div>
              </ActionForm>
            </Card>

            {editUser ? (
              <Card title={`Ubah ${editUser.email}`}>
                <ActionForm action={updateUserAction} submitLabel="Simpan perubahan">
                  <input type="hidden" name="user_id" value={editUser.id} />
                  <div className="form-grid">
                    <SelectInput
                      name="role"
                      label="Peran"
                      defaultValue={editUser.role}
                      options={[
                        { value: "kandang", label: "Kandang" },
                        { value: "manager", label: "Manager" },
                        { value: "accounting", label: "Accounting" },
                        { value: "marketing", label: "Marketing" },
                        { value: "bod", label: "Direksi" },
                        { value: "admin", label: "Admin" },
                      ]}
                    />
                    <label className="inline small" style={{ alignSelf: "end", minHeight: 44 }}>
                      <input type="checkbox" name="active" defaultChecked={editUser.active} /> Aktif
                    </label>
                  </div>
                </ActionForm>
                <div className="divider" />
                <ActionForm action={setPasswordAction} submitLabel="Atur ulang kata sandi">
                  <input type="hidden" name="email" value={editUser.email} />
                  <TextInput name="password" label="Kata sandi baru" type="password" required autoComplete="new-password" />
                </ActionForm>
              </Card>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === "penugasan" ? (
        <div className="grid grid-2">
          <Card title="Pilih pengguna">
            <DataTable
              columns={[
                { key: "nama", label: "Nama" },
                { key: "peran", label: "Peran" },
                { key: "lokasi", label: "Lokasi" },
                { key: "aksi", label: "" },
              ]}
              rows={users.map((row) => {
                const ids = assignments.filter((assignment) => assignment.user_id === row.id).map((assignment) => assignment.location_id);
                return {
                  __key: row.id,
                  nama: row.name,
                  peran: row.role,
                  lokasi: ids.map((id) => locations.find((location) => location.id === id)?.code).filter(Boolean).join(", ") || "—",
                  aksi: <Link href={`/admin?tab=penugasan&user=${row.id}`}>Atur</Link>,
                };
              })}
            />
          </Card>
          <Card title={selectedUser ? `Penugasan ${selectedUser.name}` : "Penugasan"} sub="Kandang dan manager hanya melihat lokasi yang ditugaskan.">
            <ActionForm action={assignLocationsAction} submitLabel="Simpan penugasan">
              <input type="hidden" name="user_id" value={selectedUser?.id ?? ""} />
              <div className="stack">
                {locations.map((location) => (
                  <label key={location.id} className="inline" style={{ minHeight: 44 }}>
                    <input type="checkbox" name="location_ids" value={location.id} defaultChecked={assignedIds.has(location.id)} />
                    <span>
                      <strong>{location.code}</strong> · {location.name} <span className="muted small">({location.kind})</span>
                    </span>
                  </label>
                ))}
              </div>
            </ActionForm>
          </Card>
        </div>
      ) : null}

      {tab === "parameter" ? (
        <div className="grid grid-2">
          <Card title="Parameter berlaku" sub={`Per ${fmtDateTime(new Date())}`}>
            <DataTable
              columns={[
                { key: "key", label: "Kunci" },
                { key: "value", label: "Nilai" },
                { key: "from", label: "Berlaku" },
              ]}
              rows={parameters.map((row) => ({
                __key: `${row.key}-${row.valid_from}`,
                key: <code>{row.key}</code>,
                value: <code>{JSON.stringify(row.value)}</code>,
                from: row.valid_from,
              }))}
            />
          </Card>
          <Card title="Ubah parameter" sub="Nilai JSON; versi lama tetap tersimpan per tanggal.">
            <ActionForm action={saveParameterAction} submitLabel="Simpan parameter">
              <div className="form-grid">
                <TextInput name="key" label="Kunci" required />
                <TextInput name="valid_from" label="Berlaku dari" type="date" defaultValue={today} required />
                <div className="full">
                  <TextInput name="value" label="Nilai (JSON)" required help='Contoh: 5, "20:00", [3,7,14], {"UB":55}' />
                </div>
                <div className="full">
                  <TextInput name="note" label="Catatan" />
                </div>
              </div>
            </ActionForm>
          </Card>
        </div>
      ) : null}

      {tab === "audit" ? (
        <Card title="Audit terakhir" sub="50 perubahan terbaru; hanya accounting/admin yang dapat membaca.">
          <DataTable
            columns={[
              { key: "waktu", label: "Waktu" },
              { key: "tabel", label: "Tabel" },
              { key: "aksi", label: "Aksi" },
              { key: "aktor", label: "Aktor" },
              { key: "nilai", label: "Perubahan" },
            ]}
            rows={audit.map((row) => ({
              __key: row.id,
              waktu: fmtDateTime(row.at),
              tabel: <code>{row.table_name}</code>,
              aksi: row.action,
              aktor: row.actor_email ?? "—",
              nilai:
                row.action === "UPDATE" ? (
                  <span className="small">
                    {Object.keys(row.new ?? {})
                      .filter((key) => JSON.stringify((row.old ?? {})[key]) !== JSON.stringify((row.new ?? {})[key]))
                      .slice(0, 3)
                      .map((key) => `${key}: ${JSON.stringify((row.old ?? {})[key])} → ${JSON.stringify((row.new ?? {})[key])}`)
                      .join(" · ")}
                  </span>
                ) : (
                  <span className="small muted">{row.action}</span>
                ),
            }))}
            empty="Belum ada audit."
          />
        </Card>
      ) : null}

      <Banner tone="info">
        Kata sandi tidak pernah ditampilkan. Admin membuat akun; pendaftaran mandiri ditolak oleh database.
      </Banner>
    </>
  );
}
