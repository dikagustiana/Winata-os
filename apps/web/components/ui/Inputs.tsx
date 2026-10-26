"use client";

import { useId, useState } from "react";

interface UnitOption {
  value: "kg" | "peti" | "tray" | "btr";
  label: string;
}

const DEFAULT_UNITS: UnitOption[] = [
  { value: "kg", label: "kg" },
  { value: "peti", label: "peti" },
  { value: "tray", label: "tray" },
  { value: "btr", label: "btr" },
];

export interface ConversionHint {
  kgPerCrate?: string | null;
  kgPerTray?: string | null;
  eggsPerKg?: string | null;
}

export function QuantityInput({
  name,
  label,
  units = DEFAULT_UNITS,
  defaultUnit = "kg",
  defaultValue = "",
  conversion,
  required = false,
  help,
  unitName,
}: {
  name: string;
  label: string;
  units?: UnitOption[];
  defaultUnit?: "kg" | "peti" | "tray" | "btr";
  defaultValue?: string;
  conversion?: ConversionHint;
  required?: boolean;
  help?: string;
  unitName?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const [unit, setUnit] = useState(defaultUnit);
  const uid = useId();
  const inputId = `${name}-${uid}`;

  let preview: string | null = null;
  const numeric = Number(value.replace(/\./g, "").replace(",", "."));
  if (Number.isFinite(numeric) && numeric !== 0) {
    let kg: number | null = null;
    if (unit === "kg") kg = numeric;
    else if (unit === "peti" && conversion?.kgPerCrate) kg = numeric * Number(conversion.kgPerCrate);
    else if (unit === "tray" && conversion?.kgPerTray) kg = numeric * Number(conversion.kgPerTray);
    else if (unit === "btr" && conversion?.eggsPerKg) kg = numeric / Number(conversion.eggsPerKg);
    if (kg !== null) preview = `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 }).format(kg)} kg`;
  }

  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <div className="inline" style={{ flexWrap: "nowrap" }}>
        <div className="input-affix" style={{ flex: 1 }}>
          <input
            id={inputId}
            name={name}
            className="input"
            inputMode="decimal"
            autoComplete="off"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            required={required}
          />
          <span className="affix">{units.find((u) => u.value === unit)?.label}</span>
        </div>
        <select
          name={unitName ?? `${name}_unit`}
          className="select"
          value={unit}
          onChange={(event) => setUnit(event.target.value as typeof unit)}
          aria-label={`Satuan ${label}`}
          style={{ width: 100, minWidth: 96 }}
        >
          {units.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {preview ? <span className="hint">= {preview}</span> : null}
      {help ? <span className="hint">{help}</span> : null}
    </div>
  );
}

export function TextInput({
  name,
  label,
  defaultValue = "",
  required = false,
  type = "text",
  help,
  autoComplete,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  required?: boolean;
  type?: string;
  help?: string;
  autoComplete?: string;
}) {
  const uid = useId();
  const inputId = `${name}-${uid}`;
  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        name={name}
        type={type}
        className="input"
        defaultValue={defaultValue}
        required={required}
        autoComplete={autoComplete}
      />
      {help ? <span className="hint">{help}</span> : null}
    </div>
  );
}

export function SelectInput({
  name,
  label,
  options,
  defaultValue,
  required = false,
  help,
}: {
  name: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  defaultValue?: string;
  required?: boolean;
  help?: string;
}) {
  const uid = useId();
  const inputId = `${name}-${uid}`;
  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <select id={inputId} name={name} className="select" defaultValue={defaultValue} required={required}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {help ? <span className="hint">{help}</span> : null}
    </div>
  );
}

export function DateInput({
  name,
  label,
  defaultValue,
  required = false,
  max,
  min,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  required?: boolean;
  max?: string;
  min?: string;
}) {
  const uid = useId();
  const inputId = `${name}-${uid}`;
  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        name={name}
        type="date"
        className="input"
        defaultValue={defaultValue}
        required={required}
        max={max}
        min={min}
      />
    </div>
  );
}
