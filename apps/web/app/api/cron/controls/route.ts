import { NextResponse } from "next/server";
import { getWorkerDb } from "@/lib/cloud-db";
import { cronFailure, cronGuard, isoDateParam } from "@/lib/cron";
import { processControls, todayJakarta } from "@winata/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/** GET /api/cron/controls — 20:00 WIB (13:00 UTC): kontrol harian K1–K7. */
export async function GET(request: Request) {
  const denied = cronGuard(request);
  if (denied) return denied;
  try {
    const date = isoDateParam(new URL(request.url).searchParams.get("date")) ?? todayJakarta();
    const controls = await processControls(await getWorkerDb(), date);
    return NextResponse.json({ ok: true, date, count: controls.length, fail: controls.filter((row) => row.status === "fail").length });
  } catch (error) {
    return cronFailure(error);
  }
}
