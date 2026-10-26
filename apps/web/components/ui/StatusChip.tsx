import type { ReactNode } from "react";

export type ChipStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "locked"
  | "ok"
  | "warn"
  | "fail"
  | "estimate"
  | "neutral";

const LABELS: Record<ChipStatus, string> = {
  draft: "Draft",
  submitted: "Draft",
  approved: "Disetujui",
  locked: "Dikunci",
  ok: "Aman",
  warn: "Perhatian",
  fail: "Gagal",
  estimate: "Estimasi",
  neutral: "—",
};

const CLASS: Record<ChipStatus, string> = {
  draft: "chip-draft",
  submitted: "chip-draft",
  approved: "chip-approved",
  locked: "chip-locked",
  ok: "chip-ok",
  warn: "chip-warn",
  fail: "chip-fail",
  estimate: "chip-estimate",
  neutral: "chip-neutral",
};

export function StatusChip({
  status,
  label,
  title,
  dot = false,
}: {
  status: ChipStatus;
  label?: string;
  title?: string;
  dot?: boolean;
}) {
  return (
    <span className={`chip ${CLASS[status]}`} title={title}>
      {dot ? <span className="chip-dot" aria-hidden="true" /> : null}
      {label ?? LABELS[status]}
    </span>
  );
}

export function DayStatusChip({ status }: { status: "open" | "submitted" | "approved" | "locked" }) {
  if (status === "open") {
    return (
      <span className="chip chip-neutral" title="Hari belum diselesaikan oleh kandang">
        Belum isi
      </span>
    );
  }
  return <StatusChip status={status} dot />;
}

export function EstimateTag({ children = "HPP sementara" }: { children?: ReactNode }) {
  return <span className="estimate-tag">{children}</span>;
}
