import { notFound } from "next/navigation";
import { formatKolkata } from "@outreach/core";
import { BackLink, RunModeBadge } from "@/components/bits";
import { Badge, EmptyState, PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PLAIN_PAUSE, plainReason } from "@/lib/plain";
import { STATUS_TONE } from "../labels";

interface Totals {
  target?: number;
  log?: { at: string; step: string; count: number | null; note?: string }[];
  summary?: {
    drafts: number;
    leads: number;
    creditsUsed: number;
    costUsd: number;
    minutes: number;
    dryRun: boolean;
    skipped: Record<string, number>;
    byStatus: Record<string, number>;
    needsAttention: number;
    quality?: { firstTry?: number; afterRewrite?: number; failed?: number };
  };
}

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("run.view");
  const { id } = await params;
  const supabase = await createClient();
  const { data: run } = await supabase.from("pipeline_batches").select("*, campaigns(name)").eq("id", id).maybeSingle();
  if (!run) notFound();
  const { data: drafts } = await supabase
    .from("email_drafts")
    .select("id, subject, body_text, gmail_draft_id, quality_score, created_at, campaign_leads!inner(campaign_id, lead_score, trigger, trigger_source, contacts(full_name, email, job_title, company_name))")
    .eq("campaign_leads.campaign_id", run.campaign_id)
    .not("gmail_draft_id", "is", null)
    .gte("created_at", run.started_at)
    .order("created_at")
    .limit(100);
  const t = (run.totals ?? {}) as Totals;
  const s = t.summary;
  const detail = (run.pause_detail ?? {}) as { problems?: string[]; error?: string };
  const test = (run.estimate as { dryRun?: boolean } | null)?.dryRun === true || (t as { dryRun?: boolean }).dryRun === true || s?.dryRun === true;
  return (
    <>
      <BackLink href="/">Home</BackLink>
      <PageHeader
        title={`Run: ${run.campaigns?.name ?? ""}`}
        description={`Started ${formatKolkata(run.started_at)} (IST)${run.finished_at ? `, finished ${formatKolkata(run.finished_at)}` : ""}`}
      />
      <p className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <RunModeBadge test={test} />
        <Badge tone={STATUS_TONE[run.status] ?? "neutral"}>{run.status}</Badge>
        {run.pause_reason && <span className="text-zinc-600">{PLAIN_PAUSE[run.pause_reason] ?? run.pause_reason}</span>}
        {detail.problems?.map((p) => (
          <span key={p} className="text-red-700">
            {p}
          </span>
        ))}
        {detail.error && <span className="text-red-700">{detail.error}</span>}
      </p>
      {s && (
        <div className="mb-6 grid max-w-3xl grid-cols-2 gap-4 sm:grid-cols-4" data-testid="run-summary">
          {(
            [
              ["Gmail drafts", `${s.drafts}${t.target != null ? ` / ${t.target}` : ""}`],
              ["Leads worked", s.leads],
              ["Email credits used", s.creditsUsed],
              ["Needs attention", s.needsAttention],
            ] as const
          ).map(([label, v]) => (
            <div key={label} className="rounded-lg border p-3">
              <div className="text-xl font-semibold">{v}</div>
              <div className="text-xs text-zinc-500">{label}</div>
            </div>
          ))}
        </div>
      )}
      {s?.quality && (s.quality.firstTry ?? 0) + (s.quality.afterRewrite ?? 0) + (s.quality.failed ?? 0) > 0 && (
        <p className="mb-6 text-sm" data-testid="run-quality">
          Email quality: {s.quality.firstTry ?? 0} of {(s.quality.firstTry ?? 0) + (s.quality.afterRewrite ?? 0) + (s.quality.failed ?? 0)} passed first time, {s.quality.afterRewrite ?? 0} after one rewrite, {s.quality.failed ?? 0} need attention.
        </p>
      )}
      <h2 className="mb-2 text-lg font-semibold">Gmail drafts from this run</h2>
      {!drafts?.length ? (
        <EmptyState>No drafts yet.</EmptyState>
      ) : (
        <ul className="mb-8 max-w-4xl space-y-2" data-testid="draft-list">
          {drafts.map((d) => {
            const l = d.campaign_leads;
            return (
              <li key={d.id} className="rounded-lg border p-3 text-sm" data-testid="draft-row">
                <details>
                  <summary className="cursor-pointer">
                    <span className="font-medium">{d.subject}</span>
                    <span className="text-zinc-500">
                      {" "}
                      to {l.contacts?.full_name} ({l.contacts?.job_title}, {l.contacts?.company_name}) &lt;{l.contacts?.email}&gt; · score {l.lead_score ?? "-"}
                    </span>
                  </summary>
                  <p className="mt-2 text-xs text-zinc-500">
                    Gmail draft {d.gmail_draft_id}, label AI-Outreach. Trigger: {l.trigger ?? "none"}. Source: {l.trigger_source ?? "n/a"}
                  </p>
                  <pre className="mt-2 whitespace-pre-wrap rounded-md bg-zinc-50 p-3 font-sans text-sm dark:bg-zinc-900">{d.body_text}</pre>
                </details>
              </li>
            );
          })}
        </ul>
      )}
      <h2 className="mb-2 text-lg font-semibold">Run log</h2>
      {!t.log?.length ? (
        <EmptyState>Nothing logged yet. The worker writes a line after each step.</EmptyState>
      ) : (
        <table className="w-full max-w-4xl text-sm">
          <thead className="text-left text-xs uppercase text-zinc-500">
            <tr>
              <th className="py-2">Time (IST)</th>
              <th>Step</th>
              <th>Count</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {t.log.map((l, i) => (
              <tr key={i} className="border-t" data-testid="log-row">
                <td className="py-1">{formatKolkata(l.at, { dateStyle: undefined, timeStyle: "medium" })}</td>
                <td className="font-medium">{l.step}</td>
                <td>{l.count ?? ""}</td>
                <td className="text-zinc-600">{l.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {s && Object.keys(s.skipped ?? {}).length > 0 && (
        <>
          <h2 className="mb-2 mt-8 text-lg font-semibold">Why leads were skipped</h2>
          <ul className="space-y-1 text-sm">
            {Object.entries(s.skipped ?? {}).map(([reason, n]) => (
              <li key={reason}>
                {n} × {plainReason(reason)}
              </li>
            ))}
          </ul>
        </>
      )}
      {s && (
        <p className="mt-6 text-xs text-zinc-500">
          {s.dryRun ? "Test run. " : ""}Took {s.minutes} min. Cost recorded from usage × the price table: ${s.costUsd}.
        </p>
      )}
    </>
  );
}
