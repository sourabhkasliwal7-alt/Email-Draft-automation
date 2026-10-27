import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = ["Upload", "Check columns", "Import"];

/** 1 Upload, 2 Check columns, 3 Import. `current` is the step the person is on (1-3); 4 means everything is done. */
export function ImportSteps({ current }: { current: 1 | 2 | 3 | 4 }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm" aria-label="Import steps" data-testid="import-steps">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const here = n === current;
        return (
          <li key={label} aria-current={here ? "step" : undefined} className="flex items-center gap-2">
            <span
              className={cn(
                "grid size-6 place-items-center rounded-full border text-xs font-semibold",
                done && "border-brand bg-brand text-white",
                here && "border-brand bg-brand-tint text-brand-strong",
                !done && !here && "border-zinc-300 bg-card text-muted-foreground",
              )}
              aria-hidden
            >
              {done ? <Check className="size-3.5" /> : n}
            </span>
            <span className={cn("font-medium", here ? "text-foreground" : "text-muted-foreground")}>{label}</span>
            {n < STEPS.length && <span className="mx-1 hidden h-px w-8 bg-border sm:block" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
