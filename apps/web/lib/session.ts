import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import type { AppRole, LocationRow, Viewer } from "@winata/db";
import { getAuthClient, getServiceClient, isMockAuth } from "./supabase/server";

/**
 * getViewer membaca sesi + app_user (allow-list) + penugasan lokasi.
 * Di MOCK_AUTH: cookie mock_user=<email>. Di cloud: Supabase Auth.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  let appUserId: string | null = null;
  let email: string | null = null;

  if (isMockAuth()) {
    const store = await cookies();
    email = store.get("mock_user")?.value?.toLowerCase() ?? null;
    if (!email) return null;
  } else {
    const supabase = await getAuthClient();
    const { data } = await supabase.auth.getUser();
    appUserId = data.user?.id ?? null;
    email = data.user?.email?.toLowerCase() ?? null;
    if (!appUserId || !email) return null;
  }

  const service = await getServiceClient();
  const query = service
    .from("app_user")
    .select("id,email,name,role,active")
    .eq("active", true)
    .is("deleted_at", null);
  const { data: user, error } = appUserId
    ? await query.eq("id", appUserId).maybeSingle()
    : await query.eq("email", email).maybeSingle();

  if (error || !user) return null;

  const { data: assignments } = await service
    .from("user_location")
    .select("location_id")
    .eq("user_id", user.id);

  const locationIds = ((assignments as Array<{ location_id: string }> | null) ?? []).map((a) => a.location_id);
  let locations: LocationRow[] = [];
  if (locationIds.length > 0) {
    const { data: rows } = await service
      .from("location")
      .select("id,code,name,kind,active")
      .in("id", locationIds)
      .eq("active", true)
      .order("code");
    locations = (rows as LocationRow[] | null) ?? [];
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as AppRole,
    locations,
    locationIds,
  };
});

export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  return viewer;
}

/** Rute yang tidak boleh diakses peran ini menghasilkan 404 (T-06). */
export async function requireRole(roles: AppRole[]): Promise<Viewer> {
  const viewer = await requireViewer();
  if (!roles.includes(viewer.role)) notFound();
  return viewer;
}

export function canAccess(role: AppRole, pathname: string): boolean {
  const rules: Array<[RegExp, AppRole[]]> = [
    [/^\/$/, ["kandang", "manager", "accounting", "marketing", "bod", "admin"]],
    [/^\/hari/, ["kandang", "accounting", "admin"]],
    [/^\/fisik/, ["kandang", "manager", "accounting", "admin"]],
    [/^\/approve/, ["manager", "admin"]],
    [/^\/do/, ["marketing", "accounting", "admin"]],
    [/^\/rencana/, ["marketing", "admin", "accounting"]],
    [/^\/outlook/, ["bod", "marketing", "manager", "accounting", "admin"]],
    [/^\/flok/, ["manager", "accounting", "admin"]],
    [/^\/rekonstruksi/, ["accounting", "admin"]],
    [/^\/rekon/, ["accounting", "admin", "bod"]],
    [/^\/master/, ["accounting", "admin"]],
    [/^\/admin/, ["admin"]],
  ];
  const rule = rules.find(([pattern]) => pattern.test(pathname));
  return rule ? rule[1].includes(role) : false;
}

export function roleLabel(role: AppRole): string {
  return {
    kandang: "Kandang",
    manager: "Manager",
    accounting: "Accounting",
    marketing: "Marketing",
    bod: "Direksi",
    admin: "Admin",
  }[role];
}
