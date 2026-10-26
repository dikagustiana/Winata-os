import Link from "next/link";
import type { ReactNode } from "react";
import type { Viewer } from "@winata/db";
import { fmtDate } from "@/lib/format";
import { bottomNavFor, navFor } from "@/lib/nav";
import { roleLabel } from "@/lib/session";
import { logoutAction } from "@/lib/auth-actions";
import { BottomNav, TopNav } from "./Nav";
import { LogoutButton } from "./ActionForm";

export function Shell({ viewer, date, children }: { viewer: Viewer; date: string; children: ReactNode }) {
  const items = navFor(viewer.role);
  const bottom = bottomNavFor(viewer.role);
  const locationLabel =
    viewer.locations.length === 0
      ? "semua lokasi"
      : viewer.locations.map((l) => l.code).join(" · ");

  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/" className="brand" style={{ textDecoration: "none" }}>
          <span className="brand-mark" aria-hidden="true">
            W
          </span>
          Winata Egg Position
        </Link>
        <TopNav items={items} />
        <div className="topbar-spacer" />
        <div className="topbar-meta">
          <span>{viewer.name}</span> · <span>{roleLabel(viewer.role)}</span> · <span>{locationLabel}</span>
          <br />
          <span>{fmtDate(date)} · WIB</span>
        </div>
        <form action={logoutAction}>
          <LogoutButton />
        </form>
      </header>
      <main className="main">{children}</main>
      <BottomNav items={bottom} />
    </div>
  );
}
