import { cn } from "@/lib/utils";

/** A white rounded card on the paper background. */
export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLElement>) {
  return (
    <section {...rest} className={cn("rounded-2xl border bg-card text-card-foreground shadow-card", className)}>
      {children}
    </section>
  );
}

export function CardHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("flex items-start justify-between gap-4 border-b px-5 py-4 sm:px-6", className)}>{children}</div>;
}

export function CardTitle({ className, children, as: Tag = "h2" }: { className?: string; children: React.ReactNode; as?: "h2" | "h3" }) {
  return <Tag className={cn("text-lg font-semibold leading-snug", className)}>{children}</Tag>;
}

export function CardDescription({ className, children }: { className?: string; children: React.ReactNode }) {
  return <p className={cn("mt-0.5 text-sm text-muted-foreground", className)}>{children}</p>;
}

export function CardBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("px-5 py-5 sm:px-6", className)}>{children}</div>;
}

export function CardFooter({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("flex flex-wrap items-center gap-3 border-t bg-muted/40 px-5 py-3 sm:px-6 rounded-b-2xl", className)}>{children}</div>;
}
