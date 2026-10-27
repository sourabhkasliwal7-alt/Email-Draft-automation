import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export { Badge } from "@/components/ui/badge";

/**
 * Title, ONE sentence saying what the page is for and what to do, and the page's main button on the right.
 * It sticks to the top of the scrolling area; the layout rules for `[data-page-header]` are in globals.css.
 */
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <header data-page-header className="sticky top-0 z-20 border-b bg-background/90 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 max-w-2xl">
          <h1 className="text-2xl leading-tight font-semibold sm:text-[1.75rem]">{title}</h1>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground" data-testid="page-instruction">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** What a list shows when it is empty: one sentence about what belongs here, and the next thing to do. */
export function EmptyState({ children, icon, action, className }: { children: React.ReactNode; icon?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-3 rounded-2xl border border-dashed border-zinc-300 bg-card/60 px-6 py-10 text-center", className)} data-testid="empty-state">
      <span className="grid size-11 place-items-center rounded-full bg-brand-tint text-brand" aria-hidden>
        {icon ?? <Inbox className="size-5" aria-hidden />}
      </span>
      <p className="max-w-md text-sm text-muted-foreground">{children}</p>
      {action}
    </div>
  );
}
