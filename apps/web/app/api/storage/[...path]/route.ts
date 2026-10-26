import { getViewer } from "@/lib/session";
import { readLocalObject } from "@/lib/storage";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const viewer = await getViewer();
  if (!viewer) return new Response("Tidak berwenang", { status: 401 });
  const { path } = await context.params;
  if (!path || path.length < 2) return new Response("Tidak ditemukan", { status: 404 });
  const [bucket, ...rest] = path;
  if (!["ba-photos", "attachments", "uploads"].includes(bucket)) {
    return new Response("Tidak ditemukan", { status: 404 });
  }
  const objectPath = rest.join("/");
  const buffer = await readLocalObject(bucket, objectPath);
  if (!buffer) return new Response("Tidak ditemukan", { status: 404 });
  const extension = objectPath.split(".").pop()?.toLowerCase() ?? "";
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": TYPES[extension] ?? "application/octet-stream",
      "cache-control": "private, max-age=60",
    },
  });
}

export async function HEAD() {
  return new Response(null, { status: 200 });
}
