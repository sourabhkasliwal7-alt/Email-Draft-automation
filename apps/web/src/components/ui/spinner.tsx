import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** A small spinning mark for "working on it". The text next to it is what screen readers get. */
export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role={label ? "status" : undefined} aria-label={label} className="inline-flex items-center">
      <Loader2 aria-hidden className={cn("size-4 animate-spin", className)} />
    </span>
  );
}
