"use server";

import { createClient } from "@supabase/supabase-js";
import { actionContext, checkbox, done, fail, isActionState, optionalText, refresh, text } from "./common";
import { isMockAuth } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/action-types";
import type { AppRole } from "@winata/db";

const ADMIN_ROLES: AppRole[] = ["admin"];

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

    const { data: existing } = await ctx.service
      .from("app_user")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (existing) return { error: "E-mail sudah terdaftar." };

    const id = crypto.randomUUID();
    const { error } = await ctx.client
      .from("app_user")
      .insert({ id, email, name, role, active: true, created_by: ctx.viewer.id });
    if (error) return { error: error.message };

    if (isMockAuth()) {
      const { getLocalDb } = await import("@/lib/local-db");
      const db = await getLocalDb();
      await db.query(`select set_login_password($1, $2)`, [email, password]);
    } else {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
      const admin = createClient(url, key, { auth: { persistSession: false } });
      const { error: authError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name, role },
      });
      if (authError) return { error: `Akun aplikasi dibuat, tetapi login gagal: ${authError.message}` };
    }

    refresh(["/admin", "/master"]);
    return done(`Pengguna ${email} dibuat.`);
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
    const locationIds = form.getAll("location_ids").map(String);
    const { error: deleteError } = await ctx.client.from("user_location").delete().eq("user_id", userId);
    if (deleteError) return { error: deleteError.message };
    if (locationIds.length > 0) {
      const { error } = await ctx.client
        .from("user_location")
        .insert(locationIds.map((locationId) => ({ user_id: userId, location_id: locationId, created_by: ctx.viewer.id })));
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
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
      const admin = createClient(url, key, { auth: { persistSession: false } });
      const { data } = await admin.auth.admin.listUsers();
      const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email);
      if (!user) return { error: "Pengguna Auth tidak ditemukan." };
      const { error } = await admin.auth.admin.updateUserById(user.id, { password });
      if (error) return { error: error.message };
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
