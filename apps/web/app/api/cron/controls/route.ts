import { NextResponse } from "next/server";
import { getLocalDb } from "@/lib/local-db";
import { isMockAuth } from "@/lib/supabase/server";
import { processControls, todayJakarta } from "@winata/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Tidak berwenang" }, { status: 401 });
  }
  if (!isMockAuth()) {
    return NextResponse.json(
      { error: "Worker kontrol cloud belum diimplementasikan pada build lokal; lihat docs/QUESTIONS.md Q-11." },
      { status: 501 },
    );
  }
  const date = new URL(request.url).searchParams.get("date") ?? todayJakarta();
  const db = await getLocalDb();
  const controls = await processControls(db, date);
  return NextResponse.json({ ok: true, date, count: controls.length, fail: controls.filter((row) => row.status === "fail").length });
}
