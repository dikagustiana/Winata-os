"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/action-types";
import { Card } from "@/components/ui/Card";

type ServerAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

export interface GradeConversion {
  id: string;
  code: string;
  name: string;
  kgPerCrate: number | null;
  kgPerTray: number | null;
  eggsPerKg: number | null;
  positionKg: number | null;
}

interface LineValues {
  crates: string;
  trays: string;
  loose: string;
  sampleCrates: string;
  sampleKg: string;
  sampleEggs: string;
}

const EMPTY: LineValues = { crates: "", trays: "", loose: "", sampleCrates: "", sampleKg: "", sampleEggs: "" };

function toNumber(value: string): number {
  if (value.trim() === "") return 0;
  const cleaned = value.includes(",")
    ? value.replace(/\./g, "").replace(",", ".")
    : /^-?\d{1,3}(\.\d{3})+$/.test(value)
      ? value.replace(/\./g, "")
      : value;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function computeLine(values: LineValues, grade: GradeConversion): number {
  const crates = toNumber(values.crates);
  const trays = toNumber(values.trays);
  const loose = toNumber(values.loose);
  const sampleCrates = toNumber(values.sampleCrates);
  const sampleKg = toNumber(values.sampleKg);
  const sampleEggs = toNumber(values.sampleEggs);
  const eggsPerKg = grade.eggsPerKg ?? 0;
  const kgPerCrate = sampleCrates > 0 && sampleKg > 0 ? sampleKg / sampleCrates : grade.kgPerCrate ?? 0;
  const kgPerTray = sampleEggs > 0 && eggsPerKg > 0 ? sampleEggs / eggsPerKg : grade.kgPerTray ?? 0;
  return crates * kgPerCrate + trays * kgPerTray + (eggsPerKg > 0 ? loose / eggsPerKg : 0);
}

const nf = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function PhysicalForm({
  action,
  locationId,
  date,
  mode,
  grades,
  existing,
  disabled,
  opname,
}: {
  action: ServerAction;
  locationId: string;
  date: string;
  mode: "fisik" | "opname";
  grades: GradeConversion[];
  existing: Record<string, Partial<LineValues>>;
  disabled: boolean;
  opname?: { cutoffTime: string; lastDoBefore: string; firstDoAfter: string; note: string };
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, {});
  const [values, setValues] = useState<Record<string, LineValues>>(() => {
    const initial: Record<string, LineValues> = {};
    for (const grade of grades) {
      initial[grade.id] = { ...EMPTY, ...(existing[grade.id] ?? {}) };
    }
    return initial;
  });

  function update(gradeId: string, field: keyof LineValues, value: string) {
    setValues((current) => ({ ...current, [gradeId]: { ...current[gradeId], [field]: value } }));
  }

  const totals = grades.map((grade) => ({ grade, kg: computeLine(values[grade.id], grade) }));
  const totalKg = totals.reduce((acc, row) => acc + row.kg, 0);

  return (
    <form action={formAction} className="stack">
      <input type="hidden" name="location_id" value={locationId} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="mode" value={mode} />

      {mode === "opname" ? (
        <Card title="Header BA opname" sub="Cut-off dan DO sebelum/sesudah">
          <div className="form-grid">
            <div className="field">
              <label htmlFor="cutoff_time">Jam cut-off</label>
              <input id="cutoff_time" name="cutoff_time" type="time" className="input" defaultValue={opname?.cutoffTime ?? "06:00"} disabled={disabled} />
            </div>
            <div className="field">
              <label htmlFor="last_do_before">No. DO terakhir sebelum</label>
              <input id="last_do_before" name="last_do_before" className="input" defaultValue={opname?.lastDoBefore ?? ""} disabled={disabled} />
            </div>
            <div className="field">
              <label htmlFor="first_do_after">No. DO pertama sesudah</label>
              <input id="first_do_after" name="first_do_after" className="input" defaultValue={opname?.firstDoAfter ?? ""} disabled={disabled} />
            </div>
            <div className="field">
              <label htmlFor="note">Catatan</label>
              <input id="note" name="note" className="input" defaultValue={opname?.note ?? ""} disabled={disabled} />
            </div>
          </div>
        </Card>
      ) : null}

      <Card title="Hitung per grade" sub="Peti, tray, butir sisa, dan sampel timbang. Hasil kg dihitung otomatis.">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="sticky-col">Grade</th>
                <th>Peti</th>
                <th>Tray</th>
                <th>Butir sisa</th>
                <th>Sampel peti</th>
                <th>Sampel kg</th>
                <th>Butir/tray sampel</th>
                <th className="num">Hasil kg</th>
                <th className="num">Posisi kg</th>
                <th className="num">Selisih</th>
              </tr>
            </thead>
            <tbody>
              {grades.map((grade) => {
                const line = values[grade.id] ?? EMPTY;
                const kg = computeLine(line, grade);
                const diff = grade.positionKg === null ? null : kg - grade.positionKg;
                return (
                  <tr key={grade.id}>
                    <td className="sticky-col">
                      <strong>{grade.code}</strong>
                      <div className="small muted">{grade.name}</div>
                    </td>
                    {(
                      [
                        ["crates", "Peti"],
                        ["trays", "Tray"],
                        ["loose", "Butir sisa"],
                        ["sampleCrates", "Sampel peti"],
                        ["sampleKg", "Sampel kg"],
                        ["sampleEggs", "Butir/tray"],
                      ] as Array<[keyof LineValues, string]>
                    ).map(([field, label]) => (
                      <td key={field}>
                        <input
                          className="input"
                          inputMode="decimal"
                          aria-label={`${label} ${grade.code}`}
                          name={`${field}_${grade.id}`}
                          value={line[field]}
                          onChange={(event) => update(grade.id, field, event.target.value)}
                          style={{ minWidth: 84, minHeight: 40 }}
                          disabled={disabled}
                        />
                      </td>
                    ))}
                    <td className="num">
                      <strong>{nf.format(kg)}</strong>
                    </td>
                    <td className="num">{grade.positionKg === null ? "—" : nf.format(grade.positionKg)}</td>
                    <td className={`num ${diff !== null && Math.abs(diff) > 0.1 ? "negative" : ""}`}>
                      {diff === null ? "—" : nf.format(diff)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="sticky-col">Total</td>
                <td colSpan={6} />
                <td className="num">{nf.format(totalKg)}</td>
                <td className="num">
                  {nf.format(grades.reduce((acc, grade) => acc + (grade.positionKg ?? 0), 0))}
                </td>
                <td className="num" />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          Rumus: peti × kg/peti sampel + tray × kg/tray + butir sisa ÷ butir/kg. Sampel minimal 10 peti bila stok ≥ 10
          peti; bila kurang, semua ditimbang.
        </p>
      </Card>

      <div className="action-bar">
        <button type="submit" className="btn btn-primary" disabled={disabled}>
          {mode === "opname" ? "Simpan BA opname" : "Simpan hitung fisik"}
        </button>
      </div>

      <div aria-live="polite">
        {state.error ? (
          <div className="banner banner-fail" role="alert">
            {state.error}
          </div>
        ) : null}
        {state.ok ? <div className="banner banner-ok">{state.message ?? "Tersimpan."}</div> : null}
      </div>
    </form>
  );
}
