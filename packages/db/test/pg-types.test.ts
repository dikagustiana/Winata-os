import { describe, expect, it } from "vitest";
import { cloudTypeParser, connectionConfig } from "../src/pg-cloud";

/** ARCHITECTURE-v1.1 §2: parser tipe pg cloud = bentuk data PGlite (tanpa koneksi). */
describe("parser tipe pg cloud", () => {
  it("date (1082) tetap string YYYY-MM-DD tanpa geser zona waktu", () => {
    expect(cloudTypeParser(1082)("2026-07-01")).toBe("2026-07-01");
  });

  it("numeric (1700) tetap string agar dihitung dengan Decimal", () => {
    expect(cloudTypeParser(1700)("2700.000")).toBe("2700.000");
    expect(cloudTypeParser(1700)("0.1")).toBe("0.1");
  });

  it("timestamptz (1184) dan timestamp (1114) menjadi string ISO", () => {
    expect(cloudTypeParser(1184)("2026-10-26 16:30:57.123+00")).toBe("2026-10-26T16:30:57.123Z");
    expect(cloudTypeParser(1184)("2026-10-26 23:30:57+07")).toBe("2026-10-26T16:30:57.000Z");
    expect(cloudTypeParser(1114)("2026-10-26 16:30:57")).toBe("2026-10-26T16:30:57.000Z");
  });

  it("int8 (20) menjadi number bila aman", () => {
    expect(cloudTypeParser(20)("42")).toBe(42);
    expect(cloudTypeParser(20)("9007199254740993")).toBe("9007199254740993");
  });

  it("jsonb tetap diparse menjadi objek", () => {
    expect(cloudTypeParser(3802)('{"a":[1,2]}')).toEqual({ a: [1, 2] });
  });

  it("sslmode dilepas dari URL; ssl tanpa verifikasi rantai hanya untuk host Supabase", () => {
    const supabase = connectionConfig("postgresql://postgres.abc:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require");
    expect(supabase.connectionString).not.toContain("sslmode");
    expect(supabase.ssl).toEqual({ rejectUnauthorized: false });
    expect(supabase.max).toBe(1);
    const local = connectionConfig("postgresql://postgres:pw@127.0.0.1:5432/postgres");
    expect(local.ssl).toBe(false);
  });
});
