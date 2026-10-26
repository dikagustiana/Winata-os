"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isMockAuth, getAuthClient, getServiceClient } from "./supabase/server";
import { getLocalDb } from "./local-db";
import { LOGIN_FAILED, mockPasswordError } from "./mock-auth";
import type { ActionState } from "./action-types";

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    return { error: "Email dan kata sandi wajib diisi." };
  }

  if (isMockAuth()) {
    const service = await getServiceClient();
    const { data: user } = await service
      .from("app_user")
      .select("id,email,active,role")
      .eq("email", email)
      .is("deleted_at", null)
      .maybeSingle();
    if (!user || !user.active) {
      return { error: LOGIN_FAILED };
    }
    const db = await getLocalDb();
    const stored = await db.query<{ password_hash: string | null }>(
      `select password_hash from auth.users where lower(email) = lower($1)`,
      [email],
    );
    // R-72: user tanpa password_hash ditolak (tidak lagi lolos dengan sandi apa pun).
    const passwordError = mockPasswordError(stored.rows[0]?.password_hash, password);
    if (passwordError) return { error: passwordError };
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
    const { data: session, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !session.user) return { error: LOGIN_FAILED };
    // Allow-list: login Auth tanpa app_user aktif tidak boleh masuk.
    const { data: user } = await supabase
      .from("app_user")
      .select("id,active")
      .eq("id", session.user.id)
      .eq("active", true)
      .is("deleted_at", null)
      .maybeSingle();
    if (!user) {
      await supabase.auth.signOut();
      return { error: LOGIN_FAILED };
    }
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
