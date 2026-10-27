import Link from "next/link";
import { ATTENTION_REASONS, can, formatKolkata, type SkipReason } from "@outreach/core";
import { GMAIL_MODIFY_SCOPE } from "@outreach/adapters";
import { AutoRefresh } from "@/components/auto-refresh";
import { RunModeBadge } from "@/components/bits";
import { Badge, EmptyState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/link-button";
import { requireUser } from "@/lib/auth";
import { buildChecklist, setupComplete } from "@/lib/checklist";
import { PLAIN_PAUSE, gmailDraftsUrl, plainStep } from "@/lib/plain";
import { createClient } from "@/lib/supabase/server";
import { loadWorkflowSettings } from "@/lib/workflow-settings";
import { cancelRunAction, resumeRunAction } from "./runs/actions";
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
    dryRun?: boolean;
    quality?: { firstTry?: number; afterRewrite?: number; failed?: number };
  };
}

const RUN_STATUS: Record<string, { text: string; tone: "amber" | "green" | "neutral" }> = {
  running: { text: "Running", tone: "amber" },
  paused: { text: "Paused", tone: "amber" },
  completed: { text: "Finished", tone: "green" },
  cancelled: { text: "Cancelled", tone: "neutral" },
};

const isTest = (r: { estimate: unknown; totals: unknown }) => (r.estimate as { dryRun?: boolean } | null)?.dryRun === true || (r.totals as Totals | null)?.dryRun === true || (r.totals as Totals | null)?.summary?.dryRun === true;

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

  // ---- status card
  const running = activeList.find((r) => r.status === "running");
  const paused = activeList.find((r) => r.status === "paused");
  const last = runList.find((r) => r.status === "completed" || r.status === "cancelled");
  const lastTotals = (last?.totals ?? {}) as Totals;
  const runningLog = ((running?.totals ?? {}) as Totals).log;
  let card: { title: string; text: string; tone: string };
  if (running) card = { title: `Run in progress: ${plainStep(runningLog?.[runningLog.length - 1]?.step)}`, text: `${running.campaigns?.name ?? ""} · started ${formatKolkata(running.started_at)} (IST). This page updates by itself.`, tone: "border-amber-300 bg-amber-50 dark:bg-amber-950" };
  else if (paused) card = { title: `Run paused: ${PLAIN_PAUSE[paused.pause_reason ?? ""] ?? "see the run details"}`, text: "Press Resume to carry on where it stopped (finished steps are not repeated), or Cancel.", tone: "border-amber-300 bg-amber-50 dark:bg-amber-950" };
  else if (!setupDone && setupRole) card = { title: "Set up first", text: firstOpen ? `Next: ${firstOpen.label.toLowerCase()}.` : "", tone: "border-sky-300 bg-sky-50 dark:bg-sky-950" };
  else if (last) card = { title: "Last run finished", text: `${last.campaigns?.name ?? ""} · ${last.finished_at ? formatKolkata(last.finished_at) : formatKolkata(last.started_at)} (IST)`, tone: "border-emerald-300 bg-emerald-50 dark:bg-emerald-950" };
  else card = { title: "Ready to run", text: start ? "Press Start run below. Nothing is ever sent: you get Gmail drafts to read first." : "Nothing has run yet.", tone: "border-emerald-300 bg-emerald-50 dark:bg-emerald-950" };

  // ---- last run
  const f = lastTotals.funnel;
  const q = lastTotals.summary?.quality;
  const qualityTotal = (q?.firstTry ?? 0) + (q?.afterRewrite ?? 0) + (q?.failed ?? 0);
  const funnel = [
    ["Found", f?.found ?? lastTotals.summary?.leads],
    ["Checked", f?.checked],
    ["Researched", f?.researched],
    ["Approved", f?.approved],
    ["Drafted", f?.drafted ?? lastTotals.summary?.drafts],
  ] as const;

  // ---- Apollo and demo notes (read from the server environment; keys are never shown)
  const apolloLive = process.env.ADAPTER_APOLLO?.trim().toLowerCase() === "live" && Boolean(process.env.APOLLO_API_KEY?.trim());
  const credit = (credits.data ?? []).find((c) => Boolean(c.is_mock) === !apolloLive);
  const modeOf = (n: string) => process.env[n]?.trim().toLowerCase() === "live";
  const demoParts = [
    ["Claude", modeOf("ADAPTER_LLM")],
    ["web search", modeOf("ADAPTER_SEARCH")],
    ["reading websites", modeOf("ADAPTER_FETCHER")],
    ["email checking", modeOf("ADAPTER_VERIFIER")],
    ["Gmail", modeOf("ADAPTER_GMAIL")],
  ].filter(([, live]) => !live).map(([name]) => name as string);

  const estimate = Object.fromEntries(
    campaignList.map((c) => [
      c.id,
      `Up to ${c.daily_cap} Gmail drafts today.${(c.icp as { leadSource?: string } | null)?.leadSource !== "csv" ? ` Apollo is searched for about ${Math.ceil(c.daily_cap / 0.75)} people (free); email credits are used only for approved leads, at most ${c.daily_cap}.` : ""}${c.inbox_id ? "" : " No mailbox is chosen on this campaign yet, so a real run will stop."}`,
    ]),
  );
  const draftsLink = connected[0] ? gmailDraftsUrl(connected[0].email) : null;
  const needsReconnect = inboxList.filter((i) => i.status === "active" && !i.scopes.includes(GMAIL_MODIFY_SCOPE));

  return (
    <>
      <PageHeader title="Home" description="See where things stand and start a run. A run finds leads, checks and researches them, and saves Gmail drafts. Nothing is ever sent." />
      <AutoRefresh active={Boolean(running)} />

      {workflow.skip_verification && (
        <p role="alert" data-testid="skip-verification-banner" className="mb-4 rounded-md border border-yellow-400 bg-yellow-100 p-3 text-sm font-medium text-yellow-900">
          Email checking is OFF (testing only). Emails are not verified before drafts are written. Turn it back on in Setup &gt; Advanced.
        </p>
      )}
      {demoParts.length > 0 && (
        <p data-testid="demo-mode" className="mb-4 rounded-md border border-zinc-300 bg-zinc-50 p-3 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          {demoParts.length >= 5 ? "Demo mode: nothing real is used (practice data only, no real Gmail drafts)." : `Partly demo: practice data is still used for ${demoParts.join(", ")}.`}
        </p>
      )}
      {needsReconnect.length > 0 && setupRole && (
        <p data-testid="reconnect-note" className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Reconnect needed: {needsReconnect.map((i) => i.email).join(", ")}. <Link href="/setup#mailboxes" className="underline">Reconnect in Setup</Link> so every draft gets its label.
        </p>
      )}

      <div data-testid="status-card" className={`mb-6 rounded-xl border p-6 ${card.tone}`}>
        <p className="text-2xl font-semibold" data-testid="status-title">{card.title}</p>
        {card.text && <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{card.text}</p>}
        {paused && start && (
          <div className="mt-3 flex gap-2">
            <form action={resumeRunAction}>
              <input type="hidden" name="id" value={paused.id} />
              <Button type="submit" size="sm">Resume</Button>
            </form>
            <form action={cancelRunAction}>
              <input type="hidden" name="id" value={paused.id} />
              <Button type="submit" variant="destructive" size="sm">Cancel</Button>
            </form>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          {draftsLink && (
            <a href={draftsLink} target="_blank" rel="noreferrer" data-testid="open-gmail-drafts" className="font-medium underline underline-offset-2">
              Open Gmail drafts
            </a>
          )}
          {can(user.role, "attention.view") && (
            <Link href="/drafts?tab=attention" data-testid="attention-link" className="font-medium underline underline-offset-2">
              Needs attention ({needsAttention})
            </Link>
          )}
        </div>
      </div>

      {setupRole && !setupDone && (
        <section data-testid="checklist" className="mb-6 rounded-lg border p-4">
          <h2 className="mb-2 font-semibold">Getting started</h2>
          <ol className="space-y-1 text-sm">
            {steps.map((s, i) => (
              <li key={s.key} data-testid={`step-${s.key}`} data-done={s.done} className="flex items-center gap-2">
                <span className={`inline-flex size-5 items-center justify-center rounded-full text-xs ${s.done ? "bg-emerald-600 text-white" : "border"}`}>{s.done ? "✓" : i + 1}</span>
                {s.done ? <span className="text-zinc-500 line-through">{s.label}</span> : <Link href={s.href} className="underline underline-offset-2">{s.label}</Link>}
              </li>
            ))}
          </ol>
        </section>
      )}

      <section id="start" className="mb-8 space-y-2">
        <h2 className="text-lg font-semibold">Start a run</h2>
        {!start ? (
          <p className="text-sm text-zinc-500">Only an admin or operator can start a run.</p>
        ) : !campaignList.length ? (
          <EmptyState>Create a campaign first (Setup &gt; Campaign).</EmptyState>
        ) : (
          <StartRunForm campaigns={campaignList.map((c) => ({ id: c.id, name: c.name }))} estimate={estimate} forceTest={workflow.dry_run} />
        )}
      </section>

      <section className="mb-8" data-testid="last-run">
        <h2 className="mb-2 text-lg font-semibold">Last run</h2>
        {!last ? (
          <EmptyState>No run has finished yet.</EmptyState>
        ) : (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm">
              <RunModeBadge test={isTest(last)} /> {last.campaigns?.name}
              <Link href={`/runs/${last.id}`} className="underline underline-offset-2">Details</Link>
            </p>
            <ol className="grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-5" data-testid="funnel">
              {funnel.map(([label, n]) => (
                <li key={label} className="rounded-lg border p-3 text-center">
                  <div className="text-2xl font-semibold" data-testid={`funnel-${label.toLowerCase()}`}>{n ?? "-"}</div>
                  <div className="text-xs text-zinc-500">{label}</div>
                </li>
              ))}
            </ol>
            {qualityTotal > 0 && (
              <p className="text-sm" data-testid="quality">
                Email quality: {q?.firstTry ?? 0} of {qualityTotal} passed first time, {q?.afterRewrite ?? 0} after one rewrite, {q?.failed ?? 0} need attention.
              </p>
            )}
          </div>
        )}
      </section>

      {setupRole && (
        <p className="mb-8 text-sm" data-testid="apollo-credits">
          Apollo email credits used: <strong>{credit?.today ?? 0}</strong> today, <strong>{credit?.month ?? 0}</strong> this month{apolloLive ? "" : " (demo data: Apollo is not connected)"}.
        </p>
      )}

      {viewRuns && (
        <section data-testid="recent-runs">
          <h2 className="mb-2 text-lg font-semibold">Recent runs</h2>
          {!tableRuns.length ? (
            <EmptyState>No runs yet.</EmptyState>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-zinc-500">
                <tr><th className="py-2">Started (IST)</th><th>Campaign</th><th>Type</th><th>Status</th><th>Drafts</th><th /></tr>
              </thead>
              <tbody>
                {tableRuns.map((r) => {
                  const t = (r.totals ?? {}) as Totals;
                  const st = RUN_STATUS[r.status] ?? { text: r.status, tone: "neutral" as const };
                  return (
                    <tr key={r.id} className="border-t" data-testid="run-row">
                      <td className="py-2">{formatKolkata(r.started_at)}</td>
                      <td>{r.campaigns?.name}</td>
                      <td><RunModeBadge test={isTest(r)} /></td>
                      <td>
                        <Badge tone={st.tone}>{st.text}</Badge>
                        {r.pause_reason && <div className="text-xs text-zinc-500">{PLAIN_PAUSE[r.pause_reason] ?? r.pause_reason}</div>}
                      </td>
                      <td>{t.summary?.drafts ?? "-"}{t.target != null ? ` of ${t.target}` : ""}</td>
                      <td className="flex justify-end gap-2 py-1">
                        <LinkButton variant="outline" size="sm" href={`/runs/${r.id}`}>Details</LinkButton>
                        {start && r.status === "running" && (
                          <form action={cancelRunAction}>
                            <input type="hidden" name="id" value={r.id} />
                            <Button type="submit" variant="destructive" size="sm">Cancel</Button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}
    </>
  );
}
