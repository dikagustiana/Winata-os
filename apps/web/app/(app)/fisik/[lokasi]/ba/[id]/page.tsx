import Link from "next/link";
import { notFound } from "next/navigation";
import type { GradeRow, LocationRow, OpnameLineRow, OpnameRow } from "@winata/db";
import { requireRole } from "@/lib/session";
import { viewerClient } from "@/lib/data";
import { getServiceClient } from "@/lib/supabase/server";
import { signedUrl } from "@/lib/storage";
import { fmtDate, fmtDateTime, fmtKg, fmtTime } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { PrintButton } from "@/components/ui/PrintButton";

export const dynamic = "force-dynamic";

export default async function BaPage({ params }: { params: Promise<{ lokasi: string; id: string }> }) {
  const viewer = await requireRole(["kandang", "manager", "accounting", "admin"]);
  const { lokasi, id } = await params;
  const client = await viewerClient(viewer);
  const location = ((await client
    .from("location")
    .select("id,code,name,kind,active")
    .eq("code", lokasi.toUpperCase())
    .maybeSingle()).data as LocationRow | null);
  if (!location) notFound();
  if ((viewer.role === "kandang" || viewer.role === "manager") && !viewer.locationIds.includes(location.id)) notFound();

  const opname = ((await client.from("opname").select("*").eq("id", id).maybeSingle()).data as OpnameRow | null) ?? null;
  if (!opname || opname.location_id !== location.id) notFound();

  const lines = ((await client.from("opname_line").select("*").eq("opname_id", opname.id).is("deleted_at", null)).data as OpnameLineRow[]) ?? [];
  const grades = ((await client.from("grade").select("*")).data as GradeRow[]) ?? [];
  const gradeById = new Map(grades.map((grade) => [grade.id, grade]));

  const service = await getServiceClient();
  const userIds = [opname.counter_id, opname.witness_id, opname.manager_id].filter(Boolean) as string[];
  const users = userIds.length
    ? ((await service.from("app_user").select("id,name,role").in("id", userIds)).data as Array<{ id: string; name: string; role: string }>) ?? []
    : [];
  const userName = new Map(users.map((user) => [user.id, `${user.name} (${user.role})`]));

  const totalKg = lines.reduce((acc, line) => acc + Number(line.kg), 0);
  const photos = (opname.photo_note ?? "").split(";").filter(Boolean);
  const photoLinks = await Promise.all(
    photos.map(async (photo) => ({ path: photo, url: await signedUrl("ba-photos", photo) })),
  );

  return (
    <div className="stack">
      <div className="row no-print" style={{ justifyContent: "space-between" }}>
        <Link href={`/fisik/${location.code}?mode=opname&date=${opname.date}`} className="btn btn-sm">
          ← Kembali ke hitung fisik
        </Link>
        <PrintButton />
      </div>

      <Card title={`Berita Acara Opname — ${location.name}`} sub={`${location.code} · ${fmtDate(opname.date)}`}>
        <dl className="kv">
          <dt>Jam cut-off</dt>
          <dd>{fmtTime(opname.cutoff_time)}</dd>
          <dt>DO terakhir sebelum</dt>
          <dd>{opname.last_do_before ?? "—"}</dd>
          <dt>DO pertama sesudah</dt>
          <dd>{opname.first_do_after ?? "—"}</dd>
          <dt>Status</dt>
          <dd>{opname.status === "signed" ? "Terkunci (tiga tanda tangan)" : "Draft"}</dd>
          <dt>Catatan</dt>
          <dd>{opname.note ?? "—"}</dd>
        </dl>

        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="table">
            <thead>
              <tr>
                <th className="sticky-col">Grade</th>
                <th className="num">Peti</th>
                <th className="num">Tray</th>
                <th className="num">Butir sisa</th>
                <th className="num">Sampel peti</th>
                <th className="num">Sampel kg</th>
                <th className="num">Butir/tray</th>
                <th className="num">Kg</th>
                <th className="num">Butir</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id}>
                  <td className="sticky-col">{gradeById.get(line.grade_id)?.code ?? "—"}</td>
                  <td className="num">{fmtKg(line.crates, 0)}</td>
                  <td className="num">{fmtKg(line.trays, 0)}</td>
                  <td className="num">{fmtKg(line.loose_eggs, 0)}</td>
                  <td className="num">{fmtKg(line.sample_crates, 0)}</td>
                  <td className="num">{fmtKg(line.sample_kg, 1)}</td>
                  <td className="num">{line.sample_eggs_per_tray ? fmtKg(line.sample_eggs_per_tray, 1) : "—"}</td>
                  <td className="num">
                    <strong>{fmtKg(line.kg, 1)}</strong>
                  </td>
                  <td className="num">{fmtKg(line.eggs, 0)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="sticky-col">Total</td>
                <td colSpan={6} />
                <td className="num">{fmtKg(totalKg, 1)}</td>
                <td className="num">{fmtKg(lines.reduce((acc, line) => acc + Number(line.eggs), 0), 0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="grid grid-3" style={{ marginTop: 16 }}>
          {[
            { label: "Penghitung", name: opname.counter_id, at: opname.signed_counter_at },
            { label: "Pendamping accounting", name: opname.witness_id, at: opname.signed_witness_at },
            { label: "Manager", name: opname.manager_id, at: opname.signed_manager_at },
          ].map((signature) => (
            <div key={signature.label} style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
              <div className="small muted">{signature.label}</div>
              <div style={{ minHeight: 34 }}>{signature.at ? userName.get(signature.name ?? "") ?? "—" : ""}</div>
              <div className="small">{signature.at ? fmtDateTime(signature.at) : "Belum tanda tangan"}</div>
            </div>
          ))}
        </div>

        {photos.length > 0 ? (
          <div style={{ marginTop: 16 }}>
            <div className="label">Foto</div>
            <div className="pill-list">
              {photoLinks.map(({ path, url }) => (
                <a key={path} href={url ?? "#"} target="_blank" rel="noreferrer" className="btn btn-sm">
                  Foto
                </a>
              ))}
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
