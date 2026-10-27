"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-reads the server page every couple of seconds while something is running in the worker, then stops. */
export function AutoRefresh({ active, everyMs = 2000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [active, everyMs, router]);
  return null;
}
