"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      router.refresh();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}
