import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Step {
  key: string;
  label: string;
  /** how many leads reached this step (undefined: not known yet) */
  count?: number | null;
}

/**
 * Found -> Checked -> Researched -> Approved -> Drafted, with how many leads reached each step.
 * `active` marks the step a running run is on; every step before it is shown as done.
 */
export function StepBar({ steps, active, testId = "funnel", idPrefix = "funnel" }: { steps: Step[]; active?: string; testId?: string; idPrefix?: string }) {
  const activeIndex = active ? steps.findIndex((s) => s.key === active) : -1;
  return (
    <ol className="grid grid-cols-2 gap-3 sm:grid-cols-5" data-testid={testId} aria-label="Progress">
      {steps.map((s, i) => {
        const done = activeIndex >= 0 ? i < activeIndex : s.count != null && s.count > 0;
        const current = i === activeIndex;
        return (
          <li
            key={s.key}
            aria-current={current ? "step" : undefined}
            className={cn(
              "relative rounded-xl border bg-card p-4 transition-colors",
              current && "border-amber-300 bg-amber-50/70 shadow-card",
              done && !current && "border-emerald-200 bg-emerald-50/50",
            )}
          >
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <span
                className={cn(
                  "grid size-5 place-items-center rounded-full border text-[0.7rem]",
                  done && !current && "border-brand bg-brand text-white",
                  current && "border-amber-500 bg-amber-500 text-white",
                )}
                aria-hidden
              >
                {done && !current ? <Check className="size-3" /> : i + 1}
              </span>
              <span className="uppercase tracking-wide">{s.label}</span>
            </div>
            <div className="font-heading text-3xl leading-none font-semibold" data-testid={`${idPrefix}-${s.key}`}>
              {s.count ?? "-"}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
