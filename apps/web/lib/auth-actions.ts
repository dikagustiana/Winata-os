"use server";

import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isMockAuth, getAuthClient, getServiceClient } from "./supabase/server";
import { getLocalDb } from "./local-db";
import type { ActionState } from "./action-types";

function hashLocalPassword(password: string): string {
  return createHash("sha256").update(`${password}::winata-local`).digest("hex");
}

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    return { error: "Email dan kata sandi wajib diisi." };
  }

  const service = await getServiceClient();
  const { data: user } = await service
    .from("app_user")
    .select("id,email,active,role")
    .eq("email", email)
    .maybeSingle();
  if (!user || !user.active) {
    return { error: "Email atau kata sandi salah." };
  }

  if (isMockAuth()) {
    const db = await getLocalDb();
    const stored = await db.query<{ password_hash: string | null }>(
      `select password_hash from auth.users where lower(email) = lower($1)`,
      [email],
    );
    const hash = stored.rows[0]?.password_hash;
    if (hash && hash !== hashLocalPassword(password)) {
      return { error: "Email atau kata sandi salah." };
    }
    const store = await cookies();
    store.set("mock_user", email, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12,
      secure: process.env.NODE_ENV === "production",
    });
  } else {
    const supabase = await getAuthClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: "Email atau kata sandi salah." };
  }

  redirect("/");
}

export async function logoutAction(): Promise<void> {
  if (isMockAuth()) {
    const store = await cookies();
    store.delete("mock_user");
  } else {
    const supabase = await getAuthClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}
