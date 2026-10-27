import Link from "next/link";
import { Badge } from "@/components/page-header";

/** REAL or TEST on every run shown anywhere, so nobody mistakes a test run for a real one. */
export function RunModeBadge({ test }: { test: boolean }) {
  return (
    <span data-testid={test ? "run-mode-test" : "run-mode-real"}>
      <Badge tone={test ? "amber" : "green"}>{test ? "TEST" : "REAL"}</Badge>
    </span>
  );
}

/** A clear way back from a sub-page. */
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <p className="mb-3 text-sm">
      <Link href={href} className="text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400">
        ← {children}
      </Link>
    </p>
  );
}

/** A titled block on the Setup page (the id is the in-page link target). */
export function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section id={id} data-testid={`section-${id}`} className="scroll-mt-6 space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && <p className="text-sm text-zinc-600 dark:text-zinc-400">{description}</p>}
      </div>
      {children}
    </section>
  );
}
