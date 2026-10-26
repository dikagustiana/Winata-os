import { redirect } from "next/navigation";
import { todayJakarta } from "@winata/db";
import { requireRole } from "@/lib/session";
import { loadVisibleLocations, viewerClient } from "@/lib/data";

export default async function HariIndexPage() {
  const viewer = await requireRole(["kandang", "accounting", "admin"]);
  const client = await viewerClient(viewer);
  const locations = viewer.locations.length > 0 ? viewer.locations : await loadVisibleLocations(client);
  if (locations.length === 0) {
    return <p className="banner banner-warn">Belum ada lokasi yang ditugaskan ke akun Anda.</p>;
  }
  redirect(`/hari/${locations[0].code}/${todayJakarta()}`);
}
