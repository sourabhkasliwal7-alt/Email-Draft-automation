"use client";

import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Kind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  kind: Kind;
  text: string;
}
interface ToastApi {
  success(text: string): void;
  error(text: string): void;
  info(text: string): void;
}

const Ctx = createContext<ToastApi | null>(null);

const STYLE: Record<Kind, { box: string; icon: React.ReactNode }> = {
  success: { box: "border-emerald-200", icon: <CheckCircle2 className="size-5 shrink-0 text-emerald-600" aria-hidden /> },
  error: { box: "border-red-200", icon: <AlertCircle className="size-5 shrink-0 text-red-600" aria-hidden /> },
  info: { box: "border-zinc-300", icon: <Info className="size-5 shrink-0 text-zinc-500" aria-hidden /> },
};

/** Small messages that appear after an action ("Saved", "Retry started", or what went wrong) and go away by themselves. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (kind: Kind, text: string) => {
      const id = next.current++;
      setItems((all) => [...all.filter((t) => t.text !== text).slice(-3), { id, kind, text }]);
      window.setTimeout(() => dismiss(id), kind === "error" ? 9000 : 5500);
    },
    [dismiss],
  );
  const api = useMemo<ToastApi>(() => ({ success: (t) => push("success", t), error: (t) => push("error", t), info: (t) => push("info", t) }), [push]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div aria-label="Notifications" className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(92vw,24rem)] flex-col gap-2" data-testid="toasts">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            data-testid={`toast-${t.kind}`}
            data-motion
            className={cn("pointer-events-auto flex items-start gap-3 rounded-xl border bg-card px-4 py-3 text-sm shadow-pop", STYLE[t.kind].box)}
            style={{ animation: "pop-in 0.22s ease-out both" }}
          >
            {STYLE[t.kind].icon}
            <p className="min-w-0 flex-1 break-words text-foreground">{t.text}</p>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss message" className="-m-1 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

const NOOP: ToastApi = { success: () => undefined, error: () => undefined, info: () => undefined };
/** The toast functions (they do nothing outside the app shell, so pages without it still work). */
export function useToast(): ToastApi {
  return useContext(Ctx) ?? NOOP;
}
