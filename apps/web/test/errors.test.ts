import { describe, expect, it } from "vitest";
import { HARD_DELETE_DENIED, dayClosedMessage, translateDbError } from "../lib/errors";

describe("pemetaan galat database (DESIGN-v1.1 §2)", () => {
  it("hard delete ditolak → teks Batalkan", () => {
    expect(translateDbError("permission denied for table production")).toBe(HARD_DELETE_DENIED);
  });

  it("pesan Indonesia dari raise exception diteruskan apa adanya", () => {
    const text = "DO di hari yang sudah dikunci tidak bisa dibatalkan. Buat koreksi lewat Accounting.";
    expect(translateDbError(text)).toBe(text);
  });

  it("pesan teknis diberi pembuka yang terbaca, tanpa hilang detail", () => {
    const text = 'insert or update on table "x" violates foreign key constraint "y"';
    expect(translateDbError(text)).toBe(`Perubahan ditolak oleh aturan data. (${text})`);
    expect(translateDbError("new row violates row-level security policy for table \"physical_count\"")).toMatch(
      /^Perubahan ditolak oleh aturan data\./,
    );
  });

  it("hari disetujui/dikunci", () => {
    expect(dayClosedMessage("16-10-2026", "Salopa", "locked")).toBe(
      "Hari 16-10-2026 di Salopa sudah dikunci. Minta manager mengembalikan hari ini bila perlu diubah.",
    );
    expect(dayClosedMessage("17-10-2026", "Salopa", "approved")).toContain("sudah disetujui");
  });
});
