"use server";

import { createClient } from "@supabase/supabase-js";
import { actionContext, checkbox, done, fail, isActionState, optionalText, refresh, text } from "./common";
import { SERVICE_KEY_MISSING, hasServiceKey, isMockAuth } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/action-types";
import type { AppRole } from "@winata/db";

const ADMIN_ROLES: AppRole[] = ["admin"];

function authAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).auth.admin;
}

/**
 * R-64: app_user dibuat lebih dulu (id sementara) agar trigger allow-list
 * meloloskan e-mail; lalu akun Auth dibuat; trigger auth_users_link menyamakan
 * app_user.id = auth.users.id (FK ikut, on update cascade). Bila Auth gagal,
 * app_user yang baru dibatalkan (deleted_at), bukan dihapus.
 */
export async function createUserAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(ADMIN_ROLES);
    if (isActionState(ctx)) return ctx;
    const email = text(form, "email").toLowerCase();
    const name = text(form, "name");
    const role = text(form, "role") as AppRole;
    const password = text(form, "password");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "E-mail tidak sah." };
    if (!name) return { error: "Nama wajib diisi." };
    if (!["kandang", "manager", "accounting", "marketing", "bod", "admin"].includes(role)) {
      return { error: "Peran tidak dikenal." };
    }
    if (password.length < 8) return { error: "Kata sandi minimal 8 karakter." };
    if (!hasServiceKey()) return { error: SERVICE_KEY_MISSING };

    const { data: existing } = await ctx.client
      .from("app_user")
      .select("id")
      .eq("email", email)
      .is("deleted_at", null)
      .maybeSingle();
    if (existing) return { error: "E-mail sudah terdaftar." };

    const tempId = crypto.randomUUID();
    const { error } = await ctx.client
      .from("app_user")
      .insert({ id: tempId, email, name, role, active: true, created_by: ctx.viewer.id });
    if (error) return { error: error.message };

    if (isMockAuth()) {
      const { getLocalDb } = await import("@/lib/local-db");
      const db = await getLocalDb();
      await db.query(`select set_login_password($1, $2)`, [email, password]);
    } else {
      const { error: authError } = await authAdmin().createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name, role },
      });
      if (authError) {
        await ctx.client
          .from("app_user")
          .update({ deleted_at: new Date().toISOString(), delete_reason: `Akun login gagal dibuat: ${authError.message}` })
          .eq("id", tempId);
        refresh(["/admin"]);
        return { error: `Akun login gagal dibuat; data pengguna dibatalkan. (${authError.message})` };
      }
    }

    refresh(["/admin", "/master"]);
    return done(`Pengguna ${email} dibuat dan bisa login.`);
  } catch (error) {
    return fail(error);
  }
}

export async function updateUserAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(ADMIN_ROLES);
    if (isActionState(ctx)) return ctx;
    const id = text(form, "user_id");
    const role = text(form, "role") as AppRole;
    const active = checkbox(form, "active");
    if (!id) return { error: "Pengguna tidak dipilih." };
    const { error } = await ctx.client
      .from("app_user")
      .update({ role, active, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { error: error.message };
    refresh(["/admin"]);
    return done("Pengguna diperbarui.");
  } catch (error) {
    return fail(error);
  }
}

export async function assignLocationsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(ADMIN_ROLES);
    if (isActionState(ctx)) return ctx;
    const userId = text(form, "user_id");
    if (!userId) return { error: "Pengguna tidak dipilih." };
    const wanted = new Set(form.getAll("location_ids").map(String));
    const { data: current, error: loadError } = await ctx.client
      .from("user_location")
      .select("id,location_id")
      .eq("user_id", userId)
      .is("deleted_at", null);
    if (loadError) return { error: loadError.message };
    const active = (current as Array<{ id: string; location_id: string }> | null) ?? [];

    // R-63: penugasan yang dilepas dibatalkan (deleted_at), bukan dihapus.
    for (const row of active.filter((row) => !wanted.has(row.location_id))) {
      const { error } = await ctx.client
        .from("user_location")
        .update({ deleted_at: new Date().toISOString(), delete_reason: "Penugasan dilepas admin" })
        .eq("id", row.id);
      if (error) return { error: error.message };
    }
    const existing = new Set(active.map((row) => row.location_id));
    const added = Array.from(wanted).filter((locationId) => !existing.has(locationId));
    if (added.length > 0) {
      const { error } = await ctx.client
        .from("user_location")
        .insert(added.map((locationId) => ({ user_id: userId, location_id: locationId, created_by: ctx.viewer.id })));
      if (error) return { error: error.message };
    }
    refresh(["/admin"]);
    return done("Penugasan lokasi tersimpan.");
  } catch (error) {
    return fail(error);
  }
}

export async function setPasswordAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(ADMIN_ROLES);
    if (isActionState(ctx)) return ctx;
    const email = text(form, "email").toLowerCase();
    const password = text(form, "password");
    if (password.length < 8) return { error: "Kata sandi minimal 8 karakter." };
    if (isMockAuth()) {
      const { getLocalDb } = await import("@/lib/local-db");
      const db = await getLocalDb();
      await db.query(`select set_login_password($1, $2)`, [email, password]);
    } else {
      if (!hasServiceKey()) return { error: SERVICE_KEY_MISSING };
      const { data: user } = await ctx.client
        .from("app_user")
        .select("id,name,role")
        .eq("email", email)
        .is("deleted_at", null)
        .maybeSingle();
      if (!user) return { error: "Pengguna tidak ditemukan." };
      const admin = authAdmin();
      // R-64: app_user.id = auth.users.id, jadi akun dicari langsung dengan id.
      const found = await admin.getUserById(user.id);
      if (found.data.user) {
        const { error } = await admin.updateUserById(user.id, { password });
        if (error) return { error: error.message };
      } else {
        const { error } = await admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { name: user.name, role: user.role },
        });
        if (error) return { error: `Akun login gagal dibuat. (${error.message})` };
      }
    }
    refresh(["/admin"]);
    return done("Kata sandi diperbarui.");
  } catch (error) {
    return fail(error);
  }
}

export async function saveAdminNoteAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const ctx = await actionContext(ADMIN_ROLES);
    if (isActionState(ctx)) return ctx;
    const note = optionalText(form, "note");
    if (!note) return { error: "Catatan kosong." };
    return done("Catatan: " + note);
  } catch (error) {
    return fail(error);
  }
}
