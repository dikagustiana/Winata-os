import type { ReactNode } from "react";
import { todayJakarta } from "@winata/db";
import { Shell } from "@/components/ui/Shell";
import { requireViewer } from "@/lib/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const viewer = await requireViewer();
  return (
    <Shell viewer={viewer} date={todayJakarta()}>
      {children}
    </Shell>
  );
}
