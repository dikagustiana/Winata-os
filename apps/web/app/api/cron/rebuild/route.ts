import { NextResponse } from "next/server";
import { getWorkerDb } from "@/lib/cloud-db";
import { cronFailure, cronGuard, isoDateParam } from "@/lib/cron";
import { processControls, processRebuildQueue, rebuildPositions, refreshProjection, todayJakarta } from "@winata/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/** Batas lokasi per invokasi (R-74); sisa antrean diambil invokasi berikutnya. */
const LOCATIONS_PER_RUN = 10;

/**
 * GET /api/cron/rebuild — tiap jam (vercel.json):
 * antrean rebuild → proyeksi 28 hari → kontrol hari ini.
 * Bootstrap sekali sesudah BA T0 diimpor: ?full=1&from=YYYY-MM-DD membangun
 * ulang semua lokasi dari tanggal itu.
 */
export async function GET(request: Request) {
  const denied = cronGuard(request);
  if (denied) return denied;
  try {
    const url = new URL(request.url);
    const date = isoDateParam(url.searchParams.get("date")) ?? todayJakarta();
    const db = await getWorkerDb();

    let bootstrap: { fromDate: string; toDate: string; rowsWritten: number } | null = null;
    if (url.searchParams.get("full") === "1") {
      const from = isoDateParam(url.searchParams.get("from"));
      if (!from) {
        return NextResponse.json({ error: "Parameter from=YYYY-MM-DD wajib untuk full=1." }, { status: 400 });
      }
      const result = await rebuildPositions(db, { fromDate: from });
      bootstrap = { fromDate: result.fromDate, toDate: result.toDate, rowsWritten: result.rowsWritten };
    }

    const processed = await processRebuildQueue(db, LOCATIONS_PER_RUN);
    const projected = await refreshProjection(db);
    const controls = await processControls(db, date);
    return NextResponse.json({
      ok: true,
      date,
      bootstrap,
      rebuilt: processed.length,
      processed,
      projectionRows: projected,
      controls: controls.length,
    });
  } catch (error) {
    return cronFailure(error);
  }
}
