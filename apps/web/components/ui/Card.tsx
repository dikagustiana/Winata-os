import type { ReactNode } from "react";

export function Card({
  title,
  sub,
  action,
  children,
  className = "",
  id,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section className={`card ${className}`} id={id} aria-label={typeof title === "string" ? title : undefined}>
      {title || action ? (
        <header className="card-head">
          <div>
            {title ? <h2 className="card-title">{title}</h2> : null}
            {sub ? <p className="card-sub">{sub}</p> : null}
          </div>
          {action ? <div>{action}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Metric({
  value,
  unit,
  sub,
  size = "lg",
  negative,
}: {
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  size?: "lg" | "sm";
  negative?: boolean;
}) {
  return (
    <div>
      <div className={`${size === "lg" ? "metric" : "metric-sm"} ${negative ? "negative" : ""}`}>
        {value}
        {unit ? <span className="metric-unit">{unit}</span> : null}
      </div>
      {sub ? <div className="card-sub">{sub}</div> : null}
    </div>
  );
}

export function Empty({ children = "Belum ada data." }: { children?: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Banner({
  tone = "info",
  children,
}: {
  tone?: "info" | "ok" | "warn" | "fail";
  children: ReactNode;
}) {
  return <div className={`banner banner-${tone}`}>{children}</div>;
}

export function PageHead({
  title,
  sub,
  actions,
}: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        {sub ? <p className="page-sub">{sub}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  );
}
