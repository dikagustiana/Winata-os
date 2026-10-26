"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export function Drawer({
  label,
  title,
  children,
  variant = "ghost",
}: {
  label: string;
  title: string;
  children: ReactNode;
  variant?: "ghost" | "default";
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );

    focusables()[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
      (previouslyFocused ?? triggerRef.current)?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`btn btn-sm ${variant === "ghost" ? "btn-ghost" : ""}`}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        {label}
      </button>
      {open ? (
        <div
          className="drawer-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div className="drawer" role="dialog" aria-modal="true" aria-label={title} ref={panelRef}>
            <div className="drawer-head">
              <h2 className="card-title">{title}</h2>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(false)} aria-label="Tutup">
                Tutup
              </button>
            </div>
            {children}
          </div>
        </div>
      ) : null}
    </>
  );
}
