import Link from "next/link";
import Decimal from "decimal.js";
import { todayJakarta } from "@winata/db";
import type { ControlResultRow, DayStatusRow, GradeRow, LocationRow, PositionDailyRow } from "@winata/db";
import { requireRole } from "@/lib/session";
import { viewerClient } from "@/lib/data";
import { fmtDate, fmtKg } from "@/lib/format";
import { Card, PageHead, Banner, Empty } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { ActionForm } from "@/components/ui/ActionForm";
import { TextInput } from "@/components/ui/Inputs";
import { StatusChip } from "@/components/ui/StatusChip";
import { approveDayAction, returnDayAction } from "@/lib/actions/workflow";

export const dynamic = "force-dynamic";

export default async function ApprovePage() {
  const viewer = await requireRole(["manager", "admin"]);
  const client = await viewerClient(viewer);
  const today = todayJakarta();

  const locations = ((await client.from("location").select("id,code,name,kind").eq("active", true).order("code")).data as LocationRow[]) ?? [];
  const visible = viewer.role === "admin" ? locations : locations.filter((location) => viewer.locationIds.includes(location.id));
  const grades = ((await client.from("grade").select("*").eq("active", true).order("sort")).data as GradeRow[]) ?? [];

  const submitted = ((await client
    .from("day_status")
    .select("*")
    .eq("status", "submitted")
    .is("deleted_at", null)
    .order("date", { ascending: true })).data as DayStatusRow[]) ?? [];
  const visibleIds = new Set(visible.map((location) => location.id));
  const queue = submitted.filter((row) => visibleIds.has(row.location_id));

  const approvedToday = ((await client
    .from("day_status")
    .select("*")
    .in("status", ["approved", "locked"])
    .eq("date", today)
    .is("deleted_at", null)).data as DayStatusRow[]) ?? [];

  const summaries = await Promise.all(
    queue.map(async (row) => {
      const positions = ((await client
        .from("position_daily")
        .select("*")
        .eq("location_id", row.location_id)
        .eq("date", row.date)).data as PositionDailyRow[]) ?? [];
      const controls = ((await client
        .from("control_result")
        .select("*")
        .eq("location_id", row.location_id)
        .eq("date", row.date)
        .in("code", ["K2", "K3", "K4"])).data as ControlResultRow[]) ?? [];
      return {
        row,
        position: positions,
        controls,
      };
    }),
  );

  const locationById = new Map(locations.map((location) => [location.id, location]));
  const gradeById = new Map(grades.map((grade) => [grade.id, grade]));

  return (
    <>
      <PageHead
        title="Persetujuan hari"
        sub={`${queue.length} hari menunggu disetujui · ${fmtDate(today)}`}
        actions={<Link className="btn btn-sm" href="/flok">Register flok</Link>}
      />

      {queue.length === 0 ? (
        <Banner tone="ok">Tidak ada hari yang menunggu persetujuan.</Banner>
      ) : (
        <div className="stack">
          {summaries.map(({ row, position, controls }) => {
            const location = locationById.get(row.location_id);
            const totalClosing = position.reduce((acc, item) => acc.plus(item.closing), new Decimal(0));
            const totalProduction = position.reduce((acc, item) => acc.plus(item.production), new Decimal(0));
            const totalOutbound = position.reduce((acc, item) => acc.plus(item.outbound), new Decimal(0));
            const warnings = controls.filter((control) => control.status !== "ok");
            return (
              <Card
                key={row.id}
                title={`${location?.code ?? "—"} · ${fmtDate(row.date)}`}
                sub={`${location?.name ?? ""} · diselesaikan ${row.submitted_at ? new Date(row.submitted_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "—"}`}
                action={<StatusChip status="submitted" label="Menunggu" />}
              >
                <div className="grid grid-3">
                  <div>
                    <div className="small muted">Produksi</div>
                    <div className="metric-sm">{fmtKg(totalProduction, 1)} kg</div>
                  </div>
                  <div>
                    <div className="small muted">Keluar</div>
                    <div className="metric-sm">{fmtKg(totalOutbound, 1)} kg</div>
                  </div>
                  <div>
                    <div className="small muted">Stok akhir</div>
                    <div className="metric-sm">{fmtKg(totalClosing, 1)} kg</div>
                  </div>
                </div>

                <div className="table-wrap" style={{ marginTop: 10 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Grade</th>
                        <th className="num">Awal</th>
                        <th className="num">Produksi</th>
                        <th className="num">Keluar</th>
                        <th className="num">Susut</th>
                        <th className="num">Akhir</th>
                      </tr>
                    </thead>
                    <tbody>
                      {position.map((item) => (
                        <tr key={item.grade_id}>
                          <td>{gradeById.get(item.grade_id)?.code ?? "—"}</td>
                          <td className="num">{fmtKg(item.opening, 1)}</td>
                          <td className="num">{fmtKg(item.production, 1)}</td>
                          <td className="num">{fmtKg(item.outbound, 1)}</td>
                          <td className="num">{fmtKg(item.shrinkage, 1)}</td>
                          <td className={`num ${Number(item.closing) < 0 ? "negative" : ""}`}>{fmtKg(item.closing, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {warnings.length > 0 ? (
                  <div className="stack" style={{ marginTop: 10 }}>
                    {warnings.map((control, index) => (
                      <div key={`${control.code}-${index}`} className={`banner ${control.status === "fail" ? "banner-fail" : "banner-warn"}`} title={control.code}>
                        {control.code === "K2"
                          ? "Stok akhir negatif: hari tidak bisa disetujui."
                          : control.code === "K3"
                            ? "Nomor DO perlu diperiksa."
                            : "Selisih hitung fisik perlu penjelasan."}
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="grid grid-2" style={{ marginTop: 12 }}>
                  <ActionForm action={approveDayAction} submitLabel="Setujui" successMessage="Hari disetujui.">
                    <input type="hidden" name="location_id" value={row.location_id} />
                    <input type="hidden" name="date" value={row.date} />
                  </ActionForm>
                  <ActionForm action={returnDayAction} submitLabel="Kembalikan" className="stack">
                    <input type="hidden" name="location_id" value={row.location_id} />
                    <input type="hidden" name="date" value={row.date} />
                    <TextInput name="reason" label="Alasan pengembalian" required help="Wajib, minimal 5 karakter." />
                  </ActionForm>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Card title="Sudah disetujui hari ini" sub="Menunggu kunci accounting">
        {approvedToday.length === 0 ? (
          <Empty>Belum ada hari yang disetujui hari ini.</Empty>
        ) : (
          <DataTable
            columns={[
              { key: "lokasi", label: "Lokasi" },
              { key: "tanggal", label: "Tanggal" },
              { key: "status", label: "Status" },
              { key: "aksi", label: "" },
            ]}
            rows={approvedToday
              .filter((row) => visibleIds.has(row.location_id))
              .map((row) => ({
                __key: row.id,
                lokasi: locationById.get(row.location_id)?.code ?? "—",
                tanggal: fmtDate(row.date),
                status: <StatusChip status={row.status === "locked" ? "locked" : "approved"} />,
                aksi: <Link href={`/hari/${locationById.get(row.location_id)?.code}/${row.date}`}>Lihat hari</Link>,
              }))}
          />
        )}
      </Card>

      <Banner tone="info">
        Anda tidak dapat menyetujui hari yang Anda input sendiri di lokasi yang sama, dan stok akhir negatif
        memblokir persetujuan.
      </Banner>
    </>
  );
}
