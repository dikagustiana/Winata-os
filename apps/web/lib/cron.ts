import { NextResponse } from "next/server";
import { WorkerDbMissingError, workerDbConfigured } from "./cloud-db";

/** Vercel Cron mengirim `Authorization: Bearer $CRON_SECRET` bila env terisi. */
export function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/** 401 tanpa bearer; 503 bila SUPABASE_DB_URL kosong di cloud; selain itu null. */
export function cronGuard(request: Request): NextResponse | null {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Tidak berwenang" }, { status: 401 });
  }
  if (!workerDbConfigured()) {
    return NextResponse.json({ error: new WorkerDbMissingError().message, missing: "SUPABASE_DB_URL" }, { status: 503 });
  }
  return null;
}

export function isoDateParam(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export function cronFailure(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : String(error);
  console.error("cron gagal", error);
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}
