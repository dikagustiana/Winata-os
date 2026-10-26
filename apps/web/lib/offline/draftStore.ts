"use client";

import { openDB, type IDBPDatabase } from "idb";

export interface StoredDraft {
  key: string;
  values: Record<string, string>;
  savedAt: string;
  intent?: string;
}

const DB_NAME = "winata-drafts";
const STORE = "drafts";

let connection: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!connection) {
    connection = openDB(DB_NAME, 1, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
      },
    });
  }
  return connection;
}

export async function saveDraft(draft: StoredDraft): Promise<void> {
  try {
    const database = await db();
    await database.put(STORE, draft, draft.key);
  } catch (error) {
    console.warn("draft tidak tersimpan", error);
  }
}

export async function loadDraft(key: string): Promise<StoredDraft | null> {
  try {
    const database = await db();
    return ((await database.get(STORE, key)) as StoredDraft | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function clearDraft(key: string): Promise<void> {
  try {
    const database = await db();
    await database.delete(STORE, key);
  } catch {
    // abaikan
  }
}

export async function listDrafts(): Promise<StoredDraft[]> {
  try {
    const database = await db();
    return (await database.getAll(STORE)) as StoredDraft[];
  } catch {
    return [];
  }
}
