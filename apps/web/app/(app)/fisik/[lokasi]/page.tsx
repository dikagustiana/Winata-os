import Link from "next/link";
import { notFound } from "next/navigation";
import { todayJakarta } from "@winata/db";
import type { GradeRow, LocationRow, OpnameLineRow, OpnameRow, PhysicalCountLineRow, PhysicalCountRow, PositionDailyRow } from "@winata/db";
import { requireRole } from "@/lib/session";
import { loadConversions, viewerClient } from "@/lib/data";
import { fmtDate, fmtKg, fmtTime } from "@/lib/format";
import { Card, PageHead, Banner } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { ActionForm } from "@/components/ui/ActionForm";

import { EstimateTag, StatusChip } from "@/components/ui/StatusChip";
import { signedUrl } from "@/lib/storage";
import { PhysicalForm, type GradeConversion } from "@/components/fisik/PhysicalForm";
import { TextInput } from "@/components/ui/Inputs";
import {
  cancelOpnameAction,
  markCheckedAction,
  savePhysicalCountAction,
  signOpnameAction,
  uploadBaPhotoAction,
} from "@/lib/actions/physical";
import type { ConversionRow } from "@winata/db";

export const dynamic = "force-dynamic";

const ROLES = ["kandang", "manager", "accounting", "admin"] as const;

export default async function FisikPage({
  params,
  searchParams,
}: {
  params: Promise<{ lokasi: string }>;
  searchParams: Promise<{ date?: string; mode?: string }>;
}) {
  const viewer = await requireRole([...ROLES]);
  const { lokasi } = await params;
  const query = await searchParams;
  const today = todayJakarta();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(query.date ?? "") ? query.date! : today;
  const mode = query.mode === "opname" ? "opname" : "fisik";
  const client = await viewerClient(viewer);

  const location = ((await client
    .from("location")
    .select("id,code,name,kind,active")
    .eq("code", lokasi.toUpperCase())
    .is("deleted_at", null)
    .maybeSingle()).data as LocationRow | null);
  if (!location) notFound();
  if ((viewer.role === "kandang" || viewer.role === "manager") && !viewer.locationIds.includes(location.id)) notFound();

  const grades = ((await client.from("grade").select("*").eq("active", true).order("sort")).data as GradeRow[]) ?? [];
  const conversions = await loadConversions(client, date);
  const positions = ((await client
    .from("position_daily")
    .select("grade_id,closing,production")
    .eq("location_id", location.id)
    .eq("date", date)).data as PositionDailyRow[]) ?? [];
  const positionByGrade = new Map(positions.map((row) => [row.grade_id, row.closing]));

  const physical = ((await client
    .from("physical_count")
    .select("*")
    .eq("location_id", location.id)
    .eq("date", date)
    .is("deleted_at", null)
    .maybeSingle()).data as PhysicalCountRow | null) ?? null;
  const physicalLines =
    physical
      ? ((await client
          .from("physical_count_line")
          .select("*")
          .eq("physical_count_id", physical.id)
          .is("deleted_at", null)).data as PhysicalCountLineRow[]) ?? []
      : [];

  const opname = ((await client
    .from("opname")
    .select("*")
    .eq("location_id", location.id)
    .eq("date", date)
    .is("deleted_at", null)
    .maybeSingle()).data as OpnameRow | null) ?? null;
  const opnameLines =
    opname
      ? ((await client
          .from("opname_line")
          .select("*")
          .eq("opname_id", opname.id)
          .is("deleted_at", null)).data as OpnameLineRow[]) ?? []
      : [];

  const history = ((await client
    .from("physical_count")
    .select("id,date,note,status,created_at")
    .eq("location_id", location.id)
    .is("deleted_at", null)
    .order("date", { ascending: false })
    .limit(8)).data as PhysicalCountRow[]) ?? [];

  const gradeById = new Map(grades.map((grade) => [grade.id, grade]));
  const conversionRows = new Map<string, ConversionRow>(Array.from(conversions.entries()));

  const gradeConversions: GradeConversion[] = grades.map((grade) => {
    const conversion = conversionRows.get(grade.id);
    return {
      id: grade.id,
      code: grade.code,
      name: grade.name,
      kgPerCrate: conversion?.kg_per_crate ? Number(conversion.kg_per_crate) : null,
      kgPerTray: conversion?.kg_per_tray ? Number(conversion.kg_per_tray) : null,
      eggsPerKg: conversion?.eggs_per_kg ? Number(conversion.eggs_per_kg) : null,
      positionKg: positionByGrade.has(grade.id) ? Number(positionByGrade.get(grade.id)) : null,
    };
  });

  const existing: Record<string, Record<string, string>> = {};
  const sourceLines = mode === "opname" ? opnameLines : physicalLines;
  for (const line of sourceLines) {
    existing[line.grade_id] = {
      crates: String(line.crates ?? ""),
      trays: String(line.trays ?? ""),
      loose: String(line.loose_eggs ?? ""),
      sampleCrates: String(line.sample_crates ?? ""),
      sampleKg: String(line.sample_kg ?? ""),
      sampleEggs: line.sample_eggs_per_tray ? String(line.sample_eggs_per_tray) : "",
    };
  }

  const signed = opname?.status === "signed";
  const disabled = signed;
  const photos = (opname?.photo_note ?? "").split(";").filter(Boolean);
  const photoLinks = await Promise.all(
    photos.map(async (photo) => ({ path: photo, url: await signedUrl("ba-photos", photo) })),
  );

  return (
    <>
      <PageHead
        title={`Hitung fisik · ${location.name}`}
        sub={
          <span className="row" style={{ gap: 8 }}>
            <span>{fmtDate(date)}</span>
            <StatusChip status={mode === "opname" ? "estimate" : "neutral"} label={mode === "opname" ? "Mode opname (BA)" : "Mode hitung fisik"} />
            {opname ? <StatusChip status={signed ? "ok" : "draft"} label={signed ? "BA terkunci" : "BA draft"} /> : null}
          </span>
        }
        actions={
          <>
            <Link className="btn btn-sm" href={`/fisik/${location.code}?mode=fisik&date=${date}`}>
              Hitung fisik
            </Link>
            <Link className="btn btn-sm" href={`/fisik/${location.code}?mode=opname&date=${date}`}>
              Opname (BA)
            </Link>
            {opname ? (
              <Link className="btn btn-sm" href={`/fisik/${location.code}/ba/${opname.id}`}>
                Lihat BA
              </Link>
            ) : null}
          </>
        }
      />

      <div className="row" style={{ marginBottom: 12 }}>
        <form className="row" action={`/fisik/${location.code}`} method="get">
          <input type="hidden" name="mode" value={mode} />
          <label className="label" htmlFor="date">
            Tanggal
          </label>
          <input id="date" type="date" name="date" className="input" defaultValue={date} style={{ maxWidth: 180 }} />
          <button type="submit" className="btn btn-sm">
            Tampilkan
          </button>
        </form>
      </div>

      {mode === "fisik" ? (
        <Banner tone="info">
          Hitung fisik mingguan <strong>tidak mengganti posisi</strong>. Selisih di atas toleransi wajib diberi penjelasan
          agar hari bisa dikunci.
        </Banner>
      ) : (
        <Banner tone="warn">
          Mode opname (BA): hasil per grade menjadi jangkar posisi T0 bila ini opname tertua yang ditandatangani. BA
          terkunci setelah tiga tanda tangan.
        </Banner>
      )}

      <PhysicalForm
        action={savePhysicalCountAction}
        locationId={location.id}
        date={date}
        mode={mode}
        grades={gradeConversions}
        existing={existing}
        disabled={disabled}
        opname={
          opname
            ? {
                cutoffTime: opname.cutoff_time ?? "",
                lastDoBefore: opname.last_do_before ?? "",
                firstDoAfter: opname.first_do_after ?? "",
                note: opname.note ?? "",
              }
            : undefined
        }
      />

      <div className="grid grid-2" style={{ marginTop: 12 }}>
        <Card title="Hasil tersimpan" sub={mode === "opname" ? "Baris opname" : "Perbandingan dengan posisi"}>
          <DataTable
            columns={[
              { key: "grade", label: "Grade" },
              { key: "kg", label: "Hasil kg", numeric: true },
              { key: "butir", label: "Butir", numeric: true },
              ...(mode === "fisik"
                ? [
                    { key: "posisi", label: "Posisi kg", numeric: true },
                    { key: "selisih", label: "Selisih", numeric: true },
                  ]
                : []),
            ]}
            rows={(mode === "opname" ? opnameLines : physicalLines).map((line) => ({
              __key: line.id,
              grade: gradeById.get(line.grade_id)?.code ?? "—",
              kg: fmtKg(line.kg, 1),
              butir: fmtKg(line.eggs, 0),
              posisi: "computed_kg" in line && line.computed_kg ? fmtKg(line.computed_kg, 1) : "—",
              selisih:
                "diff_kg" in line && line.diff_kg ? (
                  <span className={Number(line.diff_kg) !== 0 ? "negative" : ""}>{fmtKg(line.diff_kg, 1)}</span>
                ) : (
                  "—"
                ),
            }))}
            empty="Belum ada hasil."
          />
          {physical && mode === "fisik" ? (
            <div className="row" style={{ marginTop: 10, justifyContent: "space-between" }}>
              <span className="small muted">
                {physical.note ? `Catatan: ${physical.note}` : "Belum ada penjelasan selisih."}
              </span>
              <ActionForm action={markCheckedAction} submitLabel="Tandai diperiksa">
                <input type="hidden" name="physical_count_id" value={physical.id} />
              </ActionForm>
            </div>
          ) : null}
        </Card>

        <Card title="Tanda tangan BA" sub="Berurutan: penghitung → pendamping → manager">
          <div className="stack">
            {[
              { role: "kandang", label: "Penghitung (kandang)", at: opname?.signed_counter_at ?? null, id: opname?.counter_id ?? null },
              { role: "accounting", label: "Pendamping (accounting)", at: opname?.signed_witness_at ?? null, id: opname?.witness_id ?? null },
              { role: "manager", label: "Manager", at: opname?.signed_manager_at ?? null, id: opname?.manager_id ?? null },
            ].map((signature) => (
              <div key={signature.role} className="spread banner">
                <span>
                  <strong>{signature.label}</strong>
                  <div className="small muted">{signature.at ? fmtTime(String(signature.at)) : "Belum menandatangani"}</div>
                </span>
                {!signature.at ? (
                  <ActionForm action={signOpnameAction} submitLabel="Tanda tangan">
                    <input type="hidden" name="location_id" value={location.id} />
                    <input type="hidden" name="date" value={date} />
                  </ActionForm>
                ) : (
                  <StatusChip status="ok" label="Ditandatangani" />
                )}
              </div>
            ))}
            {opname?.status === "signed" ? <Banner tone="ok">BA terkunci. Perubahan hanya lewat koreksi accounting.</Banner> : null}
            {opname?.status === "signed" && (viewer.role === "accounting" || viewer.role === "admin") ? (
              <ActionForm
                action={cancelOpnameAction}
                buttons={[
                  {
                    label: "Batalkan BA",
                    variant: "danger",
                    confirm: "Batalkan BA opname ini? Posisi akan dibangun ulang dari tanggal ini.",
                  },
                ]}
              >
                <input type="hidden" name="opname_id" value={opname.id} />
                <TextInput name="delete_reason" label="Alasan pembatalan" help="Wajib minimal 10 karakter." />
              </ActionForm>
            ) : null}
          </div>

          <div className="divider" />
          <h3 className="card-title" style={{ fontSize: 14 }}>Foto BA</h3>
          {photos.length === 0 ? <p className="small muted">Belum ada foto.</p> : null}
          <div className="pill-list">
            {photoLinks.map(({ path, url }) => (
              <a key={path} href={url ?? "#"} target="_blank" rel="noreferrer" className="btn btn-sm">
                Foto
              </a>
            ))}
          </div>
          <div style={{ marginTop: 8 }}>
            <ActionForm action={uploadBaPhotoAction} submitLabel="Unggah foto">
              <input type="hidden" name="location_id" value={location.id} />
              <input type="hidden" name="date" value={date} />
              <div className="field">
                <label htmlFor="photo">Foto tumpukan per grade</label>
                <input id="photo" name="photo" type="file" accept="image/*" className="input" capture="environment" />
              </div>
            </ActionForm>
          </div>
        </Card>
      </div>

      <Card title="Riwayat hitung fisik" sub="8 terakhir di lokasi ini">
        <DataTable
          columns={[
            { key: "tanggal", label: "Tanggal" },
            { key: "status", label: "Status" },
            { key: "catatan", label: "Catatan" },
            { key: "aksi", label: "" },
          ]}
          rows={history.map((row) => ({
            __key: row.id,
            tanggal: fmtDate(row.date),
            status: <StatusChip status={row.status === "checked" ? "ok" : "draft"} />,
            catatan: row.note ?? "—",
            aksi: <Link href={`/fisik/${location.code}?mode=fisik&date=${row.date}`}>Buka</Link>,
          }))}
          empty="Belum ada hitung fisik."
        />
        <p className="small muted" style={{ marginTop: 8 }}>
          Nilai posisi memakai <EstimateTag />.
        </p>
      </Card>
    </>
  );
}
