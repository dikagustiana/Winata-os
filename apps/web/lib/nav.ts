import type { AppRole } from "@winata/db";

export interface NavItem {
  href: string;
  label: string;
  icon: "home" | "hari" | "fisik" | "do" | "posisi" | "approve" | "outlook" | "rekon" | "master" | "admin" | "flok" | "rencana" | "rekonstruksi";
  short?: string;
}

export function navFor(role: AppRole): NavItem[] {
  const dashboard: NavItem = { href: "/", label: "Dashboard", icon: "home" };
  switch (role) {
    case "kandang":
      return [
        dashboard,
        { href: "/hari", label: "Hari ini", icon: "hari" },
        { href: "/fisik", label: "Hitung fisik", icon: "fisik" },
      ];
    case "marketing":
      return [
        dashboard,
        { href: "/do", label: "DO", icon: "do" },
        { href: "/rencana", label: "Rencana jual", icon: "rencana" },
        { href: "/outlook", label: "Outlook", icon: "outlook" },
      ];
    case "manager":
      return [
        dashboard,
        { href: "/approve", label: "Persetujuan", icon: "approve" },
        { href: "/flok", label: "Flok", icon: "flok" },
        { href: "/outlook", label: "Outlook", icon: "outlook" },
      ];
    case "accounting":
      return [
        dashboard,
        { href: "/rekon", label: "Rekon & kunci", icon: "rekon" },
        { href: "/flok", label: "Flok", icon: "flok" },
        { href: "/outlook", label: "Outlook", icon: "outlook" },
        { href: "/master", label: "Master", icon: "master" },
      ];
    case "bod":
      return [dashboard, { href: "/outlook", label: "Outlook", icon: "outlook" }];
    case "admin":
      return [
        dashboard,
        { href: "/rekon", label: "Rekon", icon: "rekon" },
        { href: "/master", label: "Master", icon: "master" },
        { href: "/admin", label: "Admin", icon: "admin" },
        { href: "/outlook", label: "Outlook", icon: "outlook" },
      ];
    default:
      return [dashboard];
  }
}

/** Bottom nav di HP (≤ 760 px), maksimum 4 item. */
export function bottomNavFor(role: AppRole): NavItem[] {
  const items = navFor(role);
  return items.slice(0, 4);
}
