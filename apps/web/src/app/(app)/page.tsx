import { Check, FileText, Mail, PauseCircle, Rocket, Sparkles, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { ATTENTION_REASONS, can, formatKolkata, sourcesOf, type SkipReason } from "@outreach/core";
import { GMAIL_MODIFY_SCOPE } from "@outreach/adapters";
import { ActionForm } from "@/components/action-form";
import { AutoRefresh } from "@/components/auto-refresh";
import { RunModeBadge } from "@/components/bits";
import { ConfirmButton } from "@/components/confirm";
import { HelpSheet } from "@/components/help-sheet";
import { HelpTip } from "@/components/help-tip";
import { HowItWorks } from "@/components/how-it-works";
import { LinkButton } from "@/components/link-button";
import { EmptyState, PageHeader } from "@/components/page-header";
import { StepBar } from "@/components/step-bar";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { buildChecklist, setupComplete } from "@/lib/checklist";
import { PLAIN_PAUSE, gmailDraftsUrl, plainStep } from "@/lib/plain";
import { createClient } from "@/lib/supabase/server";
import { loadWorkflowSettings } from "@/lib/workflow-settings";
import { cancelRunAction, resumeRunAction } from "./runs/actions";
import type { RunEstimate } from "@/lib/run-estimate";
import { StartRunForm } from "./runs/forms";

interface Totals {
  target?: number;
  dryRun?: boolean;
  log?: { step: string; count: number | null; note?: string }[];
  funnel?: { found?: number; checked?: number; researched?: number; approved?: number; drafted?: number };
  summary?: {
    leads?: number;
    drafts?: number;
    needsAttention?: number;
    costUsd?: number;
    dryRun?: boolean;
    quality?: { firstTry?: number; afterRewrite?: number; failed?: number };
  };
}

const isTest = (r: { estimate: unknown; totals: unknown }) => (r.estimate as { dryRun?: boolean } | null)?.dryRun === true || (r.totals as Totals | null)?.dryRun === true || (r.totals as Totals | null)?.summary?.dryRun === true;

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

const STEP_LABELS = [
  ["found", "Found"],
  ["checked", "Checked"],
  ["researched", "Researched"],
  ["approved", "Approved"],
  ["drafted", "Drafted"],
] as const;
const stepsOf = (f: NonNullable<Totals["funnel"]> | undefined, fallback?: { leads?: number; drafts?: number }) =>
  STEP_LABELS.map(([key, label]) => ({ key, label, count: f?.[key] ?? (key === "found" ? fallback?.leads : key === "drafted" ? fallback?.drafts : undefined) }));

export default async function HomePage() {
  const user = await requireUser("dashboard.view");
  const supabase = await createClient();
  const viewRuns = can(user.role, "run.view");
  const start = can(user.role, "workflow.start");
  const setupRole = can(user.role, "setup.view");

  const [workflow, campaigns, inboxes, offers, leads, runs, activeRuns, attention, credits] = await Promise.all([
    loadWorkflowSettings(supabase),
    supabase.from("campaigns").select("id, name, daily_cap, inbox_id, icp").is("deleted_at", null).order("name"),
    supabase.from("inboxes").select("id, email, status, scopes").is("deleted_at", null).order("created_at"),
    supabase.from("offers").select("id", { count: "exact", head: true }).is("deleted_at", null),
    supabase.from("campaign_leads").select("id", { count: "exact", head: true }),
    viewRuns
      ? supabase.from("pipeline_batches").select("id, status, pause_reason, started_at, finished_at, totals, estimate, campaigns(name)").order("started_at", { ascending: false }).limit(8)
      : Promise.resolve({ data: [] as never[] }),
    // a run that is going or paused is always shown, however many newer runs there are
    viewRuns
      ? supabase.from("pipeline_batches").select("id, status, pause_reason, started_at, finished_at, totals, estimate, campaigns(name)").in("status", ["running", "paused"]).order("started_at", { ascending: false }).limit(5)
      : Promise.resolve({ data: [] as never[] }),
    can(user.role, "attention.view")
      ? supabase.from("campaign_leads").select("reason_codes").overlaps("reason_codes", [...ATTENTION_REASONS]).limit(500)
      : Promise.resolve({ data: [] as { reason_codes: string[] }[] }),
    setupRole ? supabase.from("v_apollo_credits").select("is_mock, today, month") : Promise.resolve({ data: [] as { is_mock: boolean | null; today: number | null; month: number | null }[] }),
  ]);

  const campaignList = campaigns.data ?? [];
  const inboxList = inboxes.data ?? [];
  type RunRow = {
    id: string;
    status: string;
    pause_reason: string | null;
    started_at: string;
    finished_at: string | null;
    totals: unknown;
    estimate: unknown;
    campaigns: { name: string } | null;
  };
  const runList = (runs.data ?? []) as RunRow[];
  const activeList = (activeRuns.data ?? []) as RunRow[];
  // the list shows the newest runs, and always the ones still going
  const tableRuns = [...activeList.filter((a) => !runList.some((r) => r.id === a.id)), ...runList].sort((a, b) => b.started_at.localeCompare(a.started_at));
  const needsAttention = (attention.data ?? []).filter((l) => ATTENTION_REASONS.includes(l.reason_codes[0] as SkipReason)).length;
  const canAttention = can(user.role, "attention.view");

  // ---- the Getting started checklist
  const connected = inboxList.filter((i) => i.status === "active");
  const steps = buildChecklist({
    gmailConnected: connected.length > 0,
    offers: offers.count ?? 0,
    footerSet: workflow.postal_address.trim() !== "" && workflow.optout_line.trim() !== "",
    campaigns: campaignList.length,
    leads: leads.count ?? 0,
    realRuns: runList.filter((r) => !isTest(r)).length,
  });
  const setupDone = setupComplete(steps);
  const firstOpen = steps.find((s) => !s.done);

  // ---- status
  const running = activeList.find((r) => r.status === "running");
  const paused = activeList.find((r) => r.status === "paused");
  const last = runList.find((r) => r.status === "completed" || r.status === "cancelled");
  const lastTotals = (last?.totals ?? {}) as Totals;
  const runningTotals = (running?.totals ?? {}) as Totals;
  const runningLog = runningTotals.log;
  let card: { title: string; text: string; accent: string; badge: React.ReactNode };
  if (running)
    card = {
      title: `Run in progress: ${plainStep(runningLog?.[runningLog.length - 1]?.step)}`,
      text: `${running.campaigns?.name ?? ""} · started ${formatKolkata(running.started_at)} (India time). This page updates by itself.`,
      accent: "border-l-amber-400",
      badge: <StatusBadge status="running" />,
    };
  else if (paused)
    card = { title: `Run paused: ${PLAIN_PAUSE[paused.pause_reason ?? ""] ?? "see the run details"}`, text: "Press Resume to carry on where it stopped (finished steps are not repeated), or Cancel.", accent: "border-l-amber-400", badge: <Badge tone="amber"><PauseCircle className="size-3.5" aria-hidden />Paused</Badge> };
  else if (!setupDone && setupRole)
    card = { title: "Set up first", text: firstOpen ? `Next: ${firstOpen.label.toLowerCase()}.` : "", accent: "border-l-zinc-300", badge: <Badge>Setting up</Badge> };
  else if (last)
    card = {
      title: "Last run finished",
      text: `${last.campaigns?.name ?? ""} · ${last.finished_at ? formatKolkata(last.finished_at) : formatKolkata(last.started_at)} (India time)`,
      accent: "border-l-emerald-500",
      badge: <StatusBadge status="completed" />,
    };
  else
    card = { title: "Ready to run", text: start ? "Choose a campaign and press Start run below. Nothing is ever sent: you get Gmail drafts to read first." : "Nothing has run yet.", accent: "border-l-emerald-500", badge: <StatusBadge status="ready" /> };

  // ---- last run
  const q = lastTotals.summary?.quality;
  const qualityTotal = (q?.firstTry ?? 0) + (q?.afterRewrite ?? 0) + (q?.failed ?? 0);

  // ---- Apollo and practice-mode notes (read from the server environment; keys are never shown)
  const apolloLive = process.env.ADAPTER_APOLLO?.trim().toLowerCase() === "live" && Boolean(process.env.APOLLO_API_KEY?.trim());
  const credit = (credits.data ?? []).find((c) => Boolean(c.is_mock) === !apolloLive);
  const modeOf = (n: string) => process.env[n]?.trim().toLowerCase() === "live";
  const demoParts = [
    ["Claude", modeOf("ADAPTER_LLM")],
    ["web search", modeOf("ADAPTER_SEARCH")],
    ["reading websites", modeOf("ADAPTER_FETCHER")],
    ["email checking", modeOf("ADAPTER_VERIFIER")],
    ["Gmail", modeOf("ADAPTER_GMAIL")],
  ]
    .filter(([, live]) => !live)
    .map(([name]) => name as string);

  // ---- what a run is expected to use: the campaign's daily limit, and what earlier real runs cost per draft
  const priced = runList
    .filter((r) => r.status === "completed" && !isTest(r))
    .map((r) => (r.totals as Totals | null)?.summary)
    .filter((s): s is NonNullable<Totals["summary"]> => Boolean(s) && (s?.drafts ?? 0) > 0 && typeof s?.costUsd === "number");
  const drafted = priced.reduce((a, s) => a + (s.drafts ?? 0), 0);
  const usdPerDraft = drafted > 0 ? priced.reduce((a, s) => a + (s.costUsd ?? 0), 0) / drafted : null;
  const estimates: Record<string, RunEstimate> = Object.fromEntries(
    campaignList.map((c) => {
      const sources = sourcesOf(c.icp as { leadSources?: string[]; leadSource?: string } | null);
      const csvOnly = sources.length === 1 && sources[0] === "csv";
      return [c.id, { drafts: c.daily_cap, credits: csvOnly ? 0 : c.daily_cap, usdPerDraft, hasMailbox: Boolean(c.inbox_id), apolloPeople: csvOnly ? 0 : Math.ceil(c.daily_cap / 0.75) }];
    }),
  );
  const draftsLink = connected[0] ? gmailDraftsUrl(connected[0].email) : null;
  const needsReconnect = inboxList.filter((i) => i.status === "active" && !i.scopes.includes(GMAIL_MODIFY_SCOPE));

  return (
    <>
      <PageHeader
        title="Home"
        description="Add leads, press Start run, then read the drafts in Gmail. Nothing is ever sent for you."
        actions={<HelpSheet variant="outline" />}
      />
      <AutoRefresh active={Boolean(running)} />

      <div className="space-y-3 empty:hidden">
        {workflow.skip_verification && (
          <p role="alert" data-testid="skip-verification-banner" className="flex items-start gap-2.5 rounded-xl border border-yellow-400 bg-yellow-100 p-3.5 text-sm font-medium text-yellow-900">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            Email checking is OFF (testing only). Emails are not verified before drafts are written. Turn it back on in Setup &gt; Advanced.
          </p>
        )}
        {demoParts.length > 0 && (
          <p data-testid="demo-mode" className="flex items-start gap-2.5 rounded-xl border bg-card p-3.5 text-sm text-muted-foreground">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
            {demoParts.length >= 5 ? "Practice mode: nothing real is used (practice data only, no real Gmail drafts)." : `Partly practice mode: practice data is still used for ${demoParts.join(", ")}.`}
          </p>
        )}
        {needsReconnect.length > 0 && setupRole && (
          <p data-testid="reconnect-note" className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-sm text-amber-900">
            <Mail className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Reconnect needed: {needsReconnect.map((i) => i.email).join(", ")}.{" "}
              <Link href="/setup?tab=gmail" className="font-medium underline underline-offset-2">
                Reconnect in Setup
              </Link>{" "}
              so every draft gets its label.
            </span>
          </p>
        )}
      </div>

      <HowItWorks />

      {setupRole && !setupDone && (
        <Card className="mb-6" data-testid="checklist" aria-labelledby="checklist-title">
          <CardHeader>
            <div>
              <CardTitle>
                <span id="checklist-title">Getting started</span>
              </CardTitle>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {steps.filter((s) => s.done).length} of {steps.length} done. Work down the list: each button takes you to the right place.
              </p>
            </div>
          </CardHeader>
          <CardBody className="py-2">
            <ol className="divide-y">
              {steps.map((s, i) => (
                <li key={s.key} data-testid={`step-${s.key}`} data-done={s.done} className="flex items-center gap-3.5 py-3">
                  <span className={`grid size-8 shrink-0 place-items-center rounded-full border text-sm font-semibold ${s.done ? "border-brand bg-brand text-white" : "border-zinc-300 bg-card text-muted-foreground"}`}>
                    {s.done ? <Check className="size-4" aria-hidden /> : i + 1}
                    <span className="sr-only">{s.done ? "Done" : "Not done yet"}</span>
                  </span>
                  <span className={`flex-1 text-[0.95rem] ${s.done ? "text-muted-foreground line-through decoration-zinc-300" : "font-medium text-foreground"}`}>
                    {s.done ? s.label : <Link href={s.href} className="hover:text-brand">{s.label}</Link>}
                  </span>
                  {!s.done && (
                    <LinkButton href={s.href} variant={s.key === firstOpen?.key ? "default" : "outline"} size="sm">
                      {s.action}
                    </LinkButton>
                  )}
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      )}

      <Card id="start" className={`mb-6 border-l-4 ${card.accent}`} data-testid="status-card">
        <CardHeader>
          <div>
            <p className="font-heading text-2xl leading-tight font-semibold" data-testid="status-title">
              {card.title}
            </p>
            {card.text && <p className="mt-1 text-sm text-muted-foreground">{card.text}</p>}
          </div>
          {card.badge}
        </CardHeader>
        <CardBody className="space-y-5">
          {running && (
            <div className="space-y-3" data-testid="live-progress">
              <StepBar steps={stepsOf(runningTotals.funnel)} active={activeStep(runningLog?.[runningLog.length - 1]?.step)} testId="live-steps" idPrefix="live" />
              <p className="text-xs text-muted-foreground">The counts fill in as each step finishes. You can leave this page: the run carries on.</p>
              {start && (
                <ActionForm action={cancelRunAction} success="The run was cancelled. It stops within a few seconds.">
                  <input type="hidden" name="id" value={running.id} />
                  <ConfirmButton variant="destructive" size="sm" confirm={{ title: "Cancel this run?", confirmLabel: "Cancel run", tone: "danger", body: <p>The run stops after the lead it is working on. Leads that were already finished keep their drafts.</p> }}>
                    Cancel run
                  </ConfirmButton>
                </ActionForm>
              )}
            </div>
          )}
          {paused && start && (
            <div className="flex flex-wrap gap-2">
              <ActionForm action={resumeRunAction} success="The run is going again.">
                <input type="hidden" name="id" value={paused.id} />
                <Button type="submit" icon={<Rocket aria-hidden />}>Resume</Button>
              </ActionForm>
              <ActionForm action={cancelRunAction} success="The run was cancelled.">
                <input type="hidden" name="id" value={paused.id} />
                <ConfirmButton variant="destructive" confirm={{ title: "Cancel this run?", confirmLabel: "Cancel run", tone: "danger", body: <p>The run stops for good. Leads that were already finished keep their drafts.</p> }}>
                  Cancel
                </ConfirmButton>
              </ActionForm>
            </div>
          )}
          {!running && !paused &&
            (!start ? (
              <p className="text-sm text-muted-foreground">Only an admin or operator can start a run.</p>
            ) : !campaignList.length ? (
              <EmptyState icon={<Rocket className="size-5" aria-hidden />} action={<LinkButton href="/setup?tab=campaigns" icon={<Rocket aria-hidden />}>Create a campaign</LinkButton>}>
                You need a campaign before you can start a run. A campaign says who to write to and which Gmail mailbox saves the drafts.
              </EmptyState>
            ) : (
              <StartRunForm campaigns={campaignList.map((c) => ({ id: c.id, name: c.name }))} estimates={estimates} forceTest={workflow.dry_run} />
            ))}
        </CardBody>
      </Card>

      <Card className="mb-6" data-testid="last-run" aria-labelledby="last-run-title">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle>
              <span id="last-run-title">Last run</span>
            </CardTitle>
            {last && <RunModeBadge test={isTest(last)} />}
          </div>
          {last && (
            <Link href={`/runs/${last.id}`} className="text-sm font-medium text-brand underline-offset-2 hover:underline">
              Details
            </Link>
          )}
        </CardHeader>
        <CardBody className="space-y-4">
          {!last ? (
            <p className="text-sm text-muted-foreground">No run has finished yet. When one does, you see here how many leads were found, checked, researched, approved and drafted.</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {last.campaigns?.name} · {last.finished_at ? formatKolkata(last.finished_at) : formatKolkata(last.started_at)} (India time)
              </p>
              <StepBar steps={stepsOf(lastTotals.funnel, lastTotals.summary)} />
              {qualityTotal > 0 && (
                <p className="rounded-lg bg-brand-soft px-3.5 py-2.5 text-sm" data-testid="quality">
                  Email quality: {q?.firstTry ?? 0} of {qualityTotal} passed first time, {q?.afterRewrite ?? 0} after one rewrite, {q?.failed ?? 0} need attention.
                </p>
              )}
            </>
          )}
        </CardBody>
        <CardFooter>
          {draftsLink && (
            <LinkButton href={draftsLink} variant="outline" icon={<Mail aria-hidden />} external data-testid="open-gmail-drafts">
              Open Gmail drafts
            </LinkButton>
          )}
          {canAttention && (
            <LinkButton href="/drafts?tab=attention" variant="outline" icon={<FileText aria-hidden />} data-testid="attention-link">
              Needs attention ({needsAttention})
            </LinkButton>
          )}
          {!draftsLink && !canAttention && <span className="text-sm text-muted-foreground">Connect a Gmail mailbox in Setup to open your drafts from here.</span>}
        </CardFooter>
      </Card>

      {setupRole && (
        <p className="mb-6 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground" data-testid="apollo-credits">
          Apollo email credits used: <strong className="text-foreground">{credit?.today ?? 0}</strong> today, <strong className="text-foreground">{credit?.month ?? 0}</strong> this month{apolloLive ? "" : " (practice data: Apollo is not connected)"}.
          <HelpTip label="email credits">
            Apollo charges one email credit each time it unlocks a person&apos;s email address. The app does it only for leads that passed the checks, and never past the daily and monthly limits in Setup.
          </HelpTip>
        </p>
      )}

      {viewRuns && (
        <Card data-testid="recent-runs" aria-labelledby="recent-title">
          <CardHeader>
            <CardTitle>
              <span id="recent-title">Recent runs</span>
            </CardTitle>
          </CardHeader>
          {!tableRuns.length ? (
            <CardBody>
              <p className="text-sm text-muted-foreground">No runs yet. Every run you start is listed here, marked Test run or Real run.</p>
            </CardBody>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  <tr>
                    <th className="px-5 py-3 sm:px-6">Started (India time)</th>
                    <th className="px-3 py-3">Campaign</th>
                    <th className="px-3 py-3">Type</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Drafts</th>
                    <th className="px-5 py-3 sm:px-6" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {tableRuns.map((r) => {
                    const t = (r.totals ?? {}) as Totals;
                    return (
                      <tr key={r.id} data-testid="run-row" className="align-middle">
                        <td className="px-5 py-3 whitespace-nowrap sm:px-6">{formatKolkata(r.started_at)}</td>
                        <td className="px-3 py-3">{r.campaigns?.name}</td>
                        <td className="px-3 py-3"><RunModeBadge test={isTest(r)} /></td>
                        <td className="px-3 py-3">
                          {r.status === "running" ? <StatusBadge status="running" /> : r.status === "paused" ? <Badge tone="amber">Paused</Badge> : r.status === "completed" ? <StatusBadge status="completed" /> : <Badge>Cancelled</Badge>}
                          {r.pause_reason && <div className="mt-1 text-xs text-muted-foreground">{PLAIN_PAUSE[r.pause_reason] ?? r.pause_reason}</div>}
                        </td>
                        <td className="px-3 py-3">
                          {t.summary?.drafts ?? "-"}
                          {t.target != null ? ` of ${t.target}` : ""}
                        </td>
                        <td className="px-5 py-3 sm:px-6">
                          <div className="flex justify-end gap-2">
                            <LinkButton variant="outline" size="sm" href={`/runs/${r.id}`}>
                              Details
                            </LinkButton>
                            {start && r.status === "running" && (
                              <ActionForm action={cancelRunAction} success="The run was cancelled. It stops within a few seconds.">
                                <input type="hidden" name="id" value={r.id} />
                                <ConfirmButton variant="destructive" size="sm" confirm={{ title: "Cancel this run?", confirmLabel: "Cancel run", tone: "danger", body: <p>The run stops after the lead it is working on. Leads that were already finished keep their drafts.</p> }}>
                                  Cancel
                                </ConfirmButton>
                              </ActionForm>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
