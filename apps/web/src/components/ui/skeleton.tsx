import { cn } from "@/lib/utils";

/** A grey shimmering block that stands in for content while a page loads. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden data-motion className={cn("skeleton rounded-lg", className)} />;
}
