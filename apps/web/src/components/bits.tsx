import { ArrowLeft, Check } from "lucide-react";
import Link from "next/link";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** "Test run" or "Real run" on every run shown anywhere, so nobody mistakes a practice run for a real one. */
export function RunModeBadge({ test }: { test: boolean }) {
  return (
    <span data-testid={test ? "run-mode-test" : "run-mode-real"}>
      <StatusBadge status={test ? "test" : "real"} />
    </span>
  );
}

/** A clear way back from a sub-page. */
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <p className="mb-4 max-lg:pl-12">
      <Link href={href} className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-brand">
        <ArrowLeft className="size-4" aria-hidden />
        {children}
      </Link>
    </p>
  );
}

/**
 * A card on the Setup page (the id is the in-page link target). `step` numbers it; `done` shows the green tick once that part is set up,
 * `optional` says it can be left alone.
 */
export function Section({
  id,
  title,
  description,
  children,
  step,
  done,
  optional,
  className,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
  step?: number | string;
  done?: boolean;
  optional?: boolean;
  className?: string;
}) {
  return (
    <section id={id} data-testid={`section-${id}`} data-done={done ?? undefined} className={cn("scroll-mt-24", className)}>
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3.5">
            {step !== undefined && (
              <span
                className={cn("mt-0.5 grid size-9 shrink-0 place-items-center rounded-full border text-sm font-semibold", done ? "border-brand bg-brand text-white" : "border-zinc-300 bg-card text-muted-foreground")}
                data-testid={`step-badge-${id}`}
              >
                {done ? <Check className="size-5" aria-hidden /> : step}
                <span className="sr-only">{done ? `Step ${step}: complete` : `Step ${step}: not finished yet`}</span>
              </span>
            )}
            <div>
              <CardTitle>{title}</CardTitle>
              {description && <CardDescription>{description}</CardDescription>}
            </div>
          </div>
          {done ? <Badge tone="green">Done</Badge> : optional ? <Badge>Optional</Badge> : null}
        </CardHeader>
        <CardBody className="space-y-4">{children}</CardBody>
      </Card>
    </section>
  );
}
