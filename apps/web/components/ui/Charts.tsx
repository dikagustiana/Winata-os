import type { ReactNode } from "react";

export interface Series {
  label: string;
  color: string;
  points: number[];
}

function pathFor(points: number[], width: number, height: number, max: number, min: number): string {
  if (points.length === 0) return "";
  const span = max - min || 1;
  const step = points.length > 1 ? width / (points.length - 1) : width;
  return points
    .map((value, index) => {
      const x = index * step;
      const y = height - ((value - min) / span) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export function Sparkline({
  series,
  width = 320,
  height = 80,
  ariaLabel,
  showArea = false,
}: {
  series: Series[];
  width?: number;
  height?: number;
  ariaLabel: string;
  showArea?: boolean;
}) {
  const all = series.flatMap((s) => s.points);
  const max = Math.max(...all, 1);
  const min = Math.min(...all, 0);
  return (
    <svg
      className="chart"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
    >
      <line x1="0" y1={height} x2={width} y2={height} stroke="var(--line)" strokeWidth="1" />
      {series.map((s) => (
        <g key={s.label}>
          {showArea ? (
            <path
              d={`${pathFor(s.points, width, height, max, min)} L${width},${height} L0,${height} Z`}
              fill={s.color}
              opacity="0.12"
            />
          ) : null}
          <path
            d={pathFor(s.points, width, height, max, min)}
            fill="none"
            stroke={s.color}
            strokeWidth="2"
            strokeLinecap="round"
          />
        </g>
      ))}
    </svg>
  );
}

export function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className="legend">
      {items.map((item) => (
        <span key={item.label}>
          <i style={{ background: item.color }} aria-hidden="true" />
          {item.label}
        </span>
      ))}
    </div>
  );
}

export function Bars({
  data,
  ariaLabel,
  height = 90,
  marker,
  markerLabel,
}: {
  data: Array<{ label: ReactNode; value: number; color?: string }>;
  ariaLabel: string;
  height?: number;
  marker?: number;
  markerLabel?: string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const barWidth = 100 / Math.max(data.length, 1);
  return (
    <div>
      <svg
        className="chart"
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
        style={{ height }}
      >
        {data.map((item, index) => {
          const barHeight = (item.value / max) * (height - 6);
          return (
            <rect
              key={index}
              x={index * barWidth + barWidth * 0.15}
              y={height - barHeight}
              width={barWidth * 0.7}
              height={barHeight}
              fill={item.color ?? "var(--accent)"}
              opacity="0.85"
              rx="1"
            />
          );
        })}
        {marker !== undefined ? (
          <line
            x1="0"
            y1={height - (marker / max) * (height - 6)}
            x2="100"
            y2={height - (marker / max) * (height - 6)}
            stroke="var(--fail)"
            strokeDasharray="2 2"
            strokeWidth="0.6"
          />
        ) : null}
      </svg>
      <div className="row" style={{ justifyContent: "space-between" }}>
        {data.map((item, index) => (
          <span key={index} className="small muted" style={{ flex: 1, textAlign: "center" }}>
            {item.label}
          </span>
        ))}
      </div>
      {marker !== undefined && markerLabel ? (
        <div className="small muted">Garis putus-putus: {markerLabel}</div>
      ) : null}
    </div>
  );
}
