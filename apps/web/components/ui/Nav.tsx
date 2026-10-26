"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { NavItem } from "@/lib/nav";

function Icon({ name }: { name: NavItem["icon"] }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const paths: Record<NavItem["icon"], ReactNode> = {
    home: <path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" {...common} />,
    hari: <><rect x="3" y="5" width="18" height="16" rx="2" {...common} /><path d="M8 3v4M16 3v4M3 10h18" {...common} /></>,
    fisik: <><path d="M4 7h16M4 12h16M4 17h10" {...common} /><circle cx="18" cy="17" r="2.5" {...common} /></>,
    do: <><path d="M6 3h9l4 4v14H6z" {...common} /><path d="M14 3v5h5M9 13h6M9 17h6" {...common} /></>,
    posisi: <><path d="M4 20V9M10 20V4M16 20v-7M22 20H2" {...common} /></>,
    approve: <><path d="m4 12 5 5L20 6" {...common} /></>,
    outlook: <><path d="M3 17l5-6 4 3 6-8 3 3" {...common} /></>,
    rekon: <><path d="M4 4h16v16H4z" {...common} /><path d="M8 9h8M8 13h5" {...common} /></>,
    master: <><circle cx="12" cy="12" r="3" {...common} /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" {...common} /></>,
    admin: <><circle cx="12" cy="8" r="3.5" {...common} /><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" {...common} /></>,
    flok: <><path d="M5 20c0-6 8-6 8-12a4 4 0 0 0-8 0" {...common} /><path d="M13 20c0-5 6-5 6-9" {...common} /></>,
    rencana: <><path d="M4 6h16M4 12h16M4 18h8" {...common} /><circle cx="18" cy="18" r="2" {...common} /></>,
    rekonstruksi: <><path d="M4 20V8l8-5 8 5v12" {...common} /><path d="M9 20v-6h6v6" {...common} /></>,
  };
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export function TopNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="topbar-nav" aria-label="Menu utama">
      {items.map((item) => (
        <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function BottomNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="bottomnav mobile-only" aria-label="Menu bawah">
      {items.map((item) => (
        <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined}>
          <Icon name={item.icon} />
          <span>{item.short ?? item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
