import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getServiceClient, hasServiceKey, isMockAuth } from "./supabase/server";

const LOCAL_ROOT = path.resolve(process.cwd(), ".local-storage");

export type Bucket = "ba-photos" | "attachments" | "uploads";

/** Abstraksi Storage (ARCHITECTURE §5): fs lokal saat MOCK_AUTH, Supabase di cloud. */
export async function putObject(
  bucket: Bucket,
  originalName: string,
  data: Buffer,
  contentType: string,
): Promise<{ path: string; url: string }> {
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const objectPath = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safeName}`;

  if (isMockAuth()) {
    const directory = path.join(LOCAL_ROOT, bucket, path.dirname(objectPath));
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(LOCAL_ROOT, bucket, objectPath), data);
    return { path: `${bucket}/${objectPath}`, url: `/api/storage/${bucket}/${objectPath}` };
  }

  const client = await getServiceClient();
  const storage = (client as unknown as { storage: { from: (bucket: string) => { upload: (path: string, body: Buffer, options?: unknown) => Promise<{ error: { message: string } | null }>; createSignedUrl: (path: string, expires: number) => Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }> } } }).storage;
  const { error } = await storage.from(bucket).upload(objectPath, data, { contentType, upsert: false });
  if (error) throw new Error(`Upload gagal: ${error.message}`);
  const signed = await storage.from(bucket).createSignedUrl(objectPath, 60 * 60);
  if (signed.error) throw new Error(`URL gagal: ${signed.error.message}`);
  return { path: `${bucket}/${objectPath}`, url: signed.data?.signedUrl ?? "" };
}

export async function signedUrl(bucket: Bucket, objectPath: string): Promise<string | null> {
  // putObject menyimpan path "<bucket>/<objek>"; Storage hanya butuh "<objek>".
  const relative = objectPath.startsWith(`${bucket}/`) ? objectPath.slice(bucket.length + 1) : objectPath;
  if (isMockAuth()) {
    return `/api/storage/${bucket}/${relative}`;
  }
  if (!hasServiceKey()) return null;
  const client = await getServiceClient();
  const storage = (client as unknown as { storage: { from: (bucket: string) => { createSignedUrl: (path: string, expires: number) => Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }> } } }).storage;
  const signed = await storage.from(bucket).createSignedUrl(relative, 60 * 60);
  return signed.data?.signedUrl ?? null;
}

export async function readLocalObject(bucket: string, objectPath: string): Promise<Buffer | null> {
  const target = path.resolve(LOCAL_ROOT, bucket, objectPath);
  const root = path.resolve(LOCAL_ROOT, bucket);
  if (!target.startsWith(root)) return null;
  try {
    return await fs.readFile(target);
  } catch {
    return null;
  }
}
