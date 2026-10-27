/**
 * A calm full-page message (no access, page not found, something went wrong): one icon, one title, one or two sentences, the next step.
 * Presentational only (no hooks), so server and client files can both use it. Icons are passed as ready elements.
 */
export function StatusPage({ icon, title, children, actions, tone = "neutral" }: { icon: React.ReactNode; title: string; children?: React.ReactNode; actions?: React.ReactNode; tone?: "neutral" | "warning" | "danger" }) {
  const ring = tone === "danger" ? "bg-red-50 text-red-700 ring-red-200" : tone === "warning" ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-brand-tint text-primary ring-emerald-200";
  return (
    <main className="grid min-h-screen place-items-center px-6 py-12">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-card">
        <span className={`mx-auto grid size-14 place-items-center rounded-2xl ring-1 ${ring} [&_svg]:size-6`} aria-hidden>
          {icon}
        </span>
        <h1 className="mt-5 text-2xl tracking-tight">{title}</h1>
        {children && <div className="mt-2 text-muted-foreground">{children}</div>}
        {actions && <div className="mt-6 flex flex-wrap justify-center gap-3">{actions}</div>}
      </div>
    </main>
  );
}
