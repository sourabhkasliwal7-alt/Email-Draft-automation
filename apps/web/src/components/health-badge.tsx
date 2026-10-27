"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type State = "loading" | "ok" | "degraded";

/** A small "the app and its background worker are running" light. */
export function HealthBadge({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health", { cache: "no-store" })
      .then((r) => (!cancelled ? setState(r.ok ? "ok" : "degraded") : undefined))
      .catch(() => (!cancelled ? setState("degraded") : undefined));
    return () => {
      cancelled = true;
    };
  }, []);

  const label = state === "loading" ? "Checking…" : state === "ok" ? "Healthy" : "Degraded";
  const color = state === "ok" ? "bg-emerald-500" : state === "degraded" ? "bg-red-500" : "bg-zinc-400";
  return (
    <span data-testid="health-badge" title={label} className={cn("inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-sm text-muted-foreground", compact && "max-lg:size-8 max-lg:justify-center max-lg:p-0")}>
      <span className={`size-2.5 shrink-0 rounded-full ${color}`} />
      <span className={compact ? "max-lg:sr-only" : undefined}>{label}</span>
    </span>
  );
}
