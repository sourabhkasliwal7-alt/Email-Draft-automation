"use client";

import { useEffect, useState } from "react";

type State = "loading" | "ok" | "degraded";

export function HealthBadge() {
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
    <span data-testid="health-badge" className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm">
      <span className={`size-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}
