import Link from "next/link";
import { ATTENTION_REASONS, can, formatKolkata, type SkipReason } from "@outreach/core";
import { Badge, EmptyState, PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { STATUS_TONE } from "./runs/labels";

async function count(table: "campaigns" | "campaign_leads" | "suppression" | "offers" | "email_drafts") {
  const supabase = await createClient();
  const { count: n } = await supabase.from(table).select("id", { count: "exact", head: true });
  return n ?? 0;
}

export default async function DashboardPage() {
  const user = await requireUser("dashboard.view");
  const supabase = await createClient();
  const viewRuns = can(user.role, "run.view");
  const [campaigns, leads, drafts, offers, suppression] = await Promise.all([count("campaigns"), count("campaign_leads"), count("email_drafts"), count("offers"), count("suppression")]);
  const { data: lastRun } = viewRuns
    ? await supabase.from("pipeline_batches").select("id, status, started_at, totals, campaigns(name)").order("started_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  const { data: attention } = can(user.role, "attention.view")
    ? await supabase.from("campaign_leads").select("reason_codes").in("status", ["disqualified", "approved"]).overlaps("reason_codes", [...ATTENTION_REASONS]).limit(500)
    : { data: [] };
  const needs = (attention ?? []).filter((l) => ATTENTION_REASONS.includes(l.reason_codes[0] as SkipReason)).length;
  const cards = [
    ["Campaigns", campaigns],
    ["Leads", leads],
    ["Drafts", drafts],
    ["Offers", offers],
    ["Suppressed", suppression],
  ] as const;
  const t = (lastRun?.totals ?? {}) as { summary?: { drafts: number; creditsUsed: number }; target?: number; log?: { step: string }[] };
  return (
    <>
      <PageHeader title="Dashboard" description={`Signed in as ${user.email} (${user.role}).`} />
      <div className="grid max-w-3xl grid-cols-2 gap-4 sm:grid-cols-3">
        {cards.map(([label, n]) => (
          <div key={label} className="rounded-lg border p-4">
            <div className="text-2xl font-semibold" data-testid={`stat-${label.toLowerCase()}`}>
              {n}
            </div>
            <div className="text-sm text-zinc-500">{label}</div>
          </div>
        ))}
        {can(user.role, "attention.view") && (
          <Link href="/attention" className="rounded-lg border p-4 hover:bg-zinc-50 dark:hover:bg-zinc-900">
            <div className="text-2xl font-semibold" data-testid="stat-attention">
              {needs}
            </div>
            <div className="text-sm text-zinc-500">Need attention</div>
          </Link>
        )}
      </div>
      {viewRuns && (
        <section className="mt-8 max-w-3xl">
          <h2 className="mb-2 text-lg font-semibold">Latest run</h2>
          {!lastRun ? (
            <EmptyState>
              No run yet. Open <Link className="underline" href="/runs">Runs</Link> and press Start.
            </EmptyState>
          ) : (
            <Link href={`/runs/${lastRun.id}`} className="block rounded-lg border p-4 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900" data-testid="latest-run">
              <div className="flex items-center gap-2">
                <Badge tone={STATUS_TONE[lastRun.status] ?? "neutral"}>{lastRun.status}</Badge>
                <span className="font-medium">{lastRun.campaigns?.name}</span>
                <span className="text-zinc-500">{formatKolkata(lastRun.started_at)} IST</span>
              </div>
              <div className="mt-2 text-zinc-600">
                {t.summary ? `${t.summary.drafts} Gmail draft(s)${t.target != null ? ` of ${t.target}` : ""}, ${t.summary.creditsUsed} reveal credit(s)` : `Working: ${t.log?.[t.log.length - 1]?.step ?? "starting"}`}
              </div>
            </Link>
          )}
        </section>
      )}
    </>
  );
}
