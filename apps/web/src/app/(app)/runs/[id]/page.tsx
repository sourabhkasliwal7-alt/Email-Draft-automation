import { ExternalLink, Rocket } from "lucide-react";
import { notFound } from "next/navigation";
import { can, formatKolkata } from "@outreach/core";
import { ActionForm } from "@/components/action-form";
import { BackLink, RunModeBadge } from "@/components/bits";
import { ConfirmButton } from "@/components/confirm";
import { LinkButton } from "@/components/link-button";
import { EmptyState, PageHeader } from "@/components/page-header";
import { StepBar } from "@/components/step-bar";
import { Badge, StatusBadge, type Status } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PLAIN_PAUSE, gmailDraftUrl, plainReason, plainStep } from "@/lib/plain";
import { cancelRunAction, resumeRunAction } from "../actions";

interface Totals {
  target?: number;
  funnel?: { found?: number; checked?: number; researched?: number; approved?: number; drafted?: number };
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

const STEPS = [
  { key: "found", label: "Found" },
  { key: "checked", label: "Checked" },
  { key: "researched", label: "Researched" },
  { key: "approved", label: "Approved" },
  { key: "drafted", label: "Drafted" },
];

/** The run's own status as one of the six badges the app uses everywhere. */
function runStatus(status: string): { status: Status; label?: string } {
  if (status === "running") return { status: "running" };
  if (status === "paused") return { status: "attention", label: "Paused" };
  if (status === "completed") return { status: "completed" };
  if (status === "cancelled") return { status: "ready", label: "Cancelled" };
  return { status: "attention", label: status };
}

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("run.view");
  const { id } = await params;
  const supabase = await createClient();
  const { data: run } = await supabase.from("pipeline_batches").select("*, campaigns(name, inbox_id)").eq("id", id).maybeSingle();
  if (!run) notFound();
  const [{ data: draftRows }, { data: inbox }] = await Promise.all([
    supabase
      .from("email_drafts")
      .select("*, campaign_leads!inner(campaign_id, lead_score, trigger, trigger_source, contacts(full_name, email, job_title, company_name))")
      .eq("campaign_leads.campaign_id", run.campaign_id)
      .not("gmail_draft_id", "is", null)
      .gte("created_at", run.started_at)
      .order("created_at")
      .limit(100),
    run.campaigns?.inbox_id ? supabase.from("inboxes").select("email").eq("id", run.campaigns.inbox_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  // gmail_message_id is newer than the generated types
  const drafts = (draftRows ?? []) as unknown as ((typeof draftRows extends (infer R)[] | null ? R : never) & { gmail_message_id?: string | null })[];
  const t = (run.totals ?? {}) as Totals;
  const s = t.summary;
  const detail = (run.pause_detail ?? {}) as { problems?: string[]; error?: string };
  const test = (run.estimate as { dryRun?: boolean } | null)?.dryRun === true || (t as { dryRun?: boolean }).dryRun === true || s?.dryRun === true;
  const manage = can(user.role, "workflow.start");
  const badge = runStatus(run.status);
  const funnel = STEPS.map((x) => ({ ...x, count: t.funnel?.[x.key as keyof NonNullable<Totals["funnel"]>] ?? (x.key === "found" ? s?.leads : x.key === "drafted" ? s?.drafts : undefined) }));
  const quality = s?.quality;
  const qualityTotal = (quality?.firstTry ?? 0) + (quality?.afterRewrite ?? 0) + (quality?.failed ?? 0);
  const lastStep = t.log?.[t.log.length - 1]?.step;

  return (
    <>
      <BackLink href="/">Home</BackLink>
      <PageHeader
        title={`Run: ${run.campaigns?.name ?? ""}`}
        description={`Started ${formatKolkata(run.started_at)} (IST)${run.finished_at ? `, finished ${formatKolkata(run.finished_at)}` : ""}`}
        actions={
          manage && run.status === "paused" ? (
            <>
              <ActionForm action={resumeRunAction} success="The run is going again.">
                <input type="hidden" name="id" value={run.id} />
                <Button type="submit" icon={<Rocket aria-hidden />}>
                  Resume
                </Button>
              </ActionForm>
              <ActionForm action={cancelRunAction} success="The run was cancelled.">
                <input type="hidden" name="id" value={run.id} />
                <ConfirmButton variant="destructive" confirm={{ title: "Cancel this run?", confirmLabel: "Cancel run", tone: "danger", body: <p>The run stops for good. Leads that were already finished keep their drafts.</p> }}>
                  Cancel
                </ConfirmButton>
              </ActionForm>
            </>
          ) : manage && run.status === "running" ? (
            <ActionForm action={cancelRunAction} success="The run was cancelled. It stops within a few seconds.">
              <input type="hidden" name="id" value={run.id} />
              <ConfirmButton variant="destructive" confirm={{ title: "Cancel this run?", confirmLabel: "Cancel run", tone: "danger", body: <p>The run stops after the lead it is working on. Leads that were already finished keep their drafts.</p> }}>
                Cancel run
              </ConfirmButton>
            </ActionForm>
          ) : undefined
        }
      />

      <div className="space-y-6 py-6">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <RunModeBadge test={test} />
          <StatusBadge status={badge.status}>{badge.label}</StatusBadge>
          {run.pause_reason && <span className="text-muted-foreground">{PLAIN_PAUSE[run.pause_reason] ?? run.pause_reason}</span>}
          {detail.problems?.map((p) => (
            <span key={p} className="text-red-700">
              {p}
            </span>
          ))}
          {detail.error && <span className="text-red-700">{detail.error}</span>}
        </div>

        <StepBar steps={funnel} active={run.status === "running" ? activeStep(lastStep) : undefined} testId="run-steps" idPrefix="run" />

        {s && (
          <div className="grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4" data-testid="run-summary">
            {(
              [
                ["Gmail drafts", `${s.drafts}${t.target != null ? ` / ${t.target}` : ""}`],
                ["Leads worked", s.leads],
                ["Email credits used", s.creditsUsed],
                ["Needs attention", s.needsAttention],
              ] as const
            ).map(([label, v]) => (
              <div key={label} className="rounded-xl border bg-card p-4 shadow-card">
                <div className="font-heading text-2xl leading-none font-semibold">{v}</div>
                <div className="mt-1.5 text-xs text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        )}
        {quality && qualityTotal > 0 && (
          <p className="text-sm" data-testid="run-quality">
            Email quality: {quality.firstTry ?? 0} of {qualityTotal} passed first time, {quality.afterRewrite ?? 0} after one rewrite, {quality.failed ?? 0} need attention.
          </p>
        )}

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Gmail drafts from this run</CardTitle>
              <CardDescription>Open the draft in Gmail to read it, change it and press Send yourself. Nothing was sent.</CardDescription>
            </div>
          </CardHeader>
          <CardBody>
            {!drafts.length ? (
              <EmptyState>No drafts yet.</EmptyState>
            ) : (
              <ul className="space-y-2.5" data-testid="draft-list">
                {drafts.map((d) => {
                  const l = d.campaign_leads;
                  return (
                    <li key={d.id} className="rounded-xl border bg-card p-3.5 text-sm" data-testid="draft-row">
                      <details>
                        <summary className="cursor-pointer">
                          <span className="font-medium">{d.subject}</span>
                          <span className="text-muted-foreground">
                            {" "}
                            to {l.contacts?.full_name} ({l.contacts?.job_title}, {l.contacts?.company_name}) &lt;{l.contacts?.email}&gt; · score {l.lead_score ?? "-"}
                          </span>
                        </summary>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs text-muted-foreground">
                            Gmail draft {d.gmail_draft_id}, label AI-Outreach. Trigger: {l.trigger ?? "none"}. Source: {l.trigger_source ?? "n/a"}
                          </p>
                          {inbox?.email && (
                            <LinkButton href={gmailDraftUrl(inbox.email, d.gmail_message_id)} external variant="outline" size="sm" icon={<ExternalLink aria-hidden />}>
                              Open in Gmail
                            </LinkButton>
                          )}
                        </div>
                        <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-muted/60 p-3 font-sans text-sm">{d.body_text}</pre>
                      </details>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Run log</CardTitle>
              <CardDescription>One line for each step, as the worker finished it.</CardDescription>
            </div>
          </CardHeader>
          <CardBody>
            {!t.log?.length ? (
              <EmptyState>Nothing logged yet. The worker writes a line after each step.</EmptyState>
            ) : (
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/60 text-left text-xs tracking-wide text-muted-foreground uppercase">
                    <tr>
                      <th className="px-4 py-2.5">Time (IST)</th>
                      <th className="px-4 py-2.5">Step</th>
                      <th className="px-4 py-2.5">Count</th>
                      <th className="px-4 py-2.5">Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {t.log.map((l, i) => (
                      <tr key={i} data-testid="log-row">
                        <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{formatKolkata(l.at, { dateStyle: undefined, timeStyle: "medium" })}</td>
                        <td className="px-4 py-2 font-medium" title={l.step}>
                          {plainStep(l.step)}
                        </td>
                        <td className="px-4 py-2">{l.count ?? ""}</td>
                        <td className="px-4 py-2 text-muted-foreground">{l.note ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>

        {s && Object.keys(s.skipped ?? {}).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Why leads were skipped</CardTitle>
            </CardHeader>
            <CardBody>
              <ul className="space-y-2 text-sm">
                {Object.entries(s.skipped ?? {}).map(([reason, n]) => (
                  <li key={reason} className="flex items-center gap-2.5">
                    <Badge>{n}</Badge>
                    {plainReason(reason)}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}
        {s && (
          <p className="text-xs text-muted-foreground">
            {s.dryRun ? "Test run. " : ""}Took {s.minutes} min. Cost recorded from usage × the price table: ${s.costUsd}.
          </p>
        )}
      </div>
    </>
  );
}

/** Which of the five steps a running run is on, from the last line of its log. */
function activeStep(step: string | undefined): string {
  switch (step) {
    case "quick check":
      return "checked";
    case "research and score":
      return "researched";
    case "approve":
    case "approve (dry run)":
      return "approved";
    case "reveal and verify":
    case "errors":
    case "done":
      return "drafted";
    default:
      return "found";
  }
}
