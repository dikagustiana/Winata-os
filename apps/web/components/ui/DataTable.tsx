import type { ReactNode } from "react";

export interface Column {
  key: string;
  label: ReactNode;
  numeric?: boolean;
  className?: string;
}

export interface TableProps {
  columns: Column[];
  rows: Array<Record<string, ReactNode>>;
  footer?: ReactNode;
  caption?: string;
  empty?: string;
}

export function DataTable({ columns, rows, footer, caption, empty = "Belum ada data." }: TableProps) {
  if (rows.length === 0) {
    return <div className="empty">{empty}</div>;
  }
  return (
    <div className="table-wrap">
      <table className="table">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th
                key={column.key}
                scope="col"
                className={`${column.numeric ? "num" : ""} ${index === 0 ? "sticky-col" : ""} ${column.className ?? ""}`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={String(row.__key ?? rowIndex)}>
              {columns.map((column, index) => (
                <td
                  key={column.key}
                  className={`${column.numeric ? "num" : ""} ${index === 0 ? "sticky-col" : ""} ${column.className ?? ""}`}
                >
                  {row[column.key] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer ? <tfoot>{footer}</tfoot> : null}
      </table>
    </div>
  );
}
