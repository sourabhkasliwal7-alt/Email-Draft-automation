import { Check } from "lucide-react";
import Link from "next/link";
import { SETUP_TABS, setupTabHref, type SetupTab, type TabMark } from "@/lib/setup-tabs";
import { cn } from "@/lib/utils";

/**
 * The seven tabs of Setup, numbered "1 Gmail ... 7 Advanced". Each is a link, so the address always shows where you are.
 * A green tick = this part is complete, an orange dot = it needs action, nothing = optional or technical.
 */
export function SetupTabs({ active, marks }: { active: SetupTab; marks: Record<SetupTab, TabMark> }) {
  return (
    <nav aria-label="Setup sections" data-testid="setup-tabs" className="-mx-1 overflow-x-auto px-1 pb-1">
      <ul className="flex min-w-max gap-1 rounded-xl border bg-card p-1 shadow-card">
        {SETUP_TABS.map((t, i) => {
          const mark = marks[t.key];
          const isActive = t.key === active;
          return (
            <li key={t.key}>
              <Link
                href={setupTabHref(t.key)}
                aria-current={isActive ? "page" : undefined}
                data-testid={`tab-${t.key}`}
                data-mark={mark}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                  isActive ? "bg-brand text-white shadow-sm" : "text-zinc-600 hover:bg-muted hover:text-foreground",
                )}
              >
                <span className={cn("text-xs tabular-nums", isActive ? "text-white/75" : "text-zinc-400")}>{i + 1}</span>
                {t.label}
                {mark === "done" && (
                  <span className={cn("grid size-4 place-items-center rounded-full", isActive ? "bg-white text-brand" : "bg-brand text-white")}>
                    <Check className="size-3" strokeWidth={3} aria-hidden />
                    <span className="sr-only">complete</span>
                  </span>
                )}
                {mark === "todo" && (
                  <span className="relative grid size-4 place-items-center">
                    <span className="size-2.5 rounded-full bg-amber-500 ring-2 ring-card" aria-hidden />
                    <span className="sr-only">needs action</span>
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
