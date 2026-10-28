import { ExternalLink, Play } from "lucide-react";
import Link from "next/link";
import { can, formatKolkata, leadSourceLabel, sourcesOf } from "@outreach/core";
import { AutoRefresh } from "@/components/auto-refresh";
import { inputClass } from "@/components/form";
import { LinkButton } from "@/components/link-button";
import { Badge, EmptyState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { isTestActive, latestApolloFinds, latestScreenRechecks, latestWebFinds, type FindRow, type RecheckRow, type WebFindCompany, type WebFindRow } from "@/lib/adapter-tests";
import { requireUser } from "@/lib/auth";
import { EMAIL_MISMATCH_LABEL, emailStatusWords, hasEmailMismatch } from "@/lib/email-style";
import { gmailDraftUrl, plainLeadStatus } from "@/lib/plain";
import { RECHECK_REASONS, quickCheckOf, recheckCounts, recheckLine } from "@/lib/quick-check";
import { createClient } from "@/lib/supabase/server";
import { UploadForm } from "../import/forms";
import { FindApolloForm, FindWebForm, RecheckForm } from "./forms";

function findLine(row: FindRow | undefined): { text: string; tone: "ok" | "wait" | "error" } | null {
  if (!row) return null;
  if (row.state === "waiting" || row.state === "running") return { text: row.waitingTooLong ? "Waiting for the background worker. Is it running? (pnpm dev starts it.)" : "Searching…", tone: "wait" };
  if (row.state === "failed" || !row.result) return { text: `The search failed: ${row.error ?? "no answer from the background worker"}`, tone: "error" };
  const r = row.result;
  const parts = [`found ${r.found ?? 0}`, `added ${r.imported ?? 0}`];
  if (r.duplicate) parts.push(`${r.duplicate} already in your list`);
  if (r.suppressed) parts.push(`${r.suppressed} on your do-not-contact list`);
  if (r.invalid) parts.push(`${r.invalid} unusable`);
  return { text: `${r.demo ? "Practice data (demo): " : ""}${parts.join(", ")}.${r.note ? ` ${r.note}` : ""}`, tone: "ok" };
}

function webLine(row: WebFindRow | undefined): { text: string; tone: "ok" | "wait" | "error" } | null {
  if (!row) return null;
  if (row.state === "waiting" || row.state === "running") return { text: row.waitingTooLong ? "Waiting for the background worker. Is it running? (pnpm dev starts it.)" : "Searching Google and checking the companies…", tone: "wait" };
  if (row.state === "failed" || !row.result) return { text: `The search failed: ${row.error ?? "no answer from the background worker"}`, tone: "error" };
  const r = row.result;
  const parts = [`${r.queriesRun ?? 0} searches`, `${r.results ?? 0} results`, `${r.kept ?? 0} company sites kept`, `${r.checked ?? 0} passed the quick check`, `${r.contacts ?? 0} people found`];
  if (r.noContact) parts.push(`${r.noContact} with no contact found`);
  return { text: `${r.demo ? "Practice data (demo): " : ""}${parts.join(", ")}.${r.note ? ` ${r.note}` : ""}`, tone: "ok" };
}

const OUTCOME: Record<WebFindCompany["outcome"], { label: string; tone: "green" | "amber" | "neutral" }> = {
  lead: { label: "Added as a lead", tone: "green" },
  "no-contact": { label: "No contact found", tone: "amber" },
  "failed-check": { label: "Not a fit", tone: "neutral" },
  "no-data": { label: "Site not readable", tone: "neutral" },
};

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ campaign?: string }> }) {
  const user = await requireUser("lead.view");
  const { campaign: campaignFilter } = await searchParams;
  const supabase = await createClient();
  const canAdd = can(user.role, "import.use");
  const canRecheck = can(user.role, "workflow.start");

  let query = supabase
    .from("campaign_leads")
    .select("id, status, next_action, reason_codes, lead_score, created_at, campaign_id, lead_source, source_detail, score_components, campaigns(name), contacts(full_name, job_title, email, email_status, company_name, companies(name, domain))")
    .order("created_at", { ascending: false })
    .limit(200);
  if (campaignFilter) query = query.eq("campaign_id", campaignFilter);
  const [{ data: leads }, { data: campaigns }, { data: uploads }, finds, webFinds, rechecks, { data: skippedRows }] = await Promise.all([
    query,
    supabase.from("campaigns").select("id, name, icp").is("deleted_at", null).order("name"),
    canAdd ? supabase.from("import_batches").select("id, file_name, status, dry_run, totals, created_at, campaigns(name)").order("created_at", { ascending: false }).limit(5) : Promise.resolve({ data: [] }),
    canAdd ? latestApolloFinds() : Promise.resolve({} as Record<string, FindRow>),
    canAdd ? latestWebFinds() : Promise.resolve({} as Record<string, WebFindRow>),
    canRecheck ? latestScreenRechecks() : Promise.resolve({} as Record<string, RecheckRow>),
    // every lead a second quick check could help, in all campaigns (not only the 200 shown below)
    canRecheck ? supabase.from("campaign_leads").select("campaign_id, status, reason_codes").eq("status", "disqualified").overlaps("reason_codes", [...RECHECK_REASONS]).limit(5000) : Promise.resolve({ data: [] as { campaign_id: string; status: string; reason_codes: string[] }[] }),
  ]);
  const recheckable = recheckCounts(skippedRows ?? []);
  const recheckCampaigns = (campaigns ?? []).filter((c) => (recheckable[c.id] ?? 0) > 0 || rechecks[c.id]);
  const campaignList = campaigns ?? [];
  const usesSource = (c: { icp: unknown }, s: "apollo" | "web") => sourcesOf(c.icp as { leadSources?: string[]; leadSource?: string } | null).includes(s);
  const apolloCampaigns = campaignList.filter((c) => usesSource(c, "apollo"));
  const webCampaigns = campaignList.filter((c) => usesSource(c, "web"));
  const apolloLive = process.env.ADAPTER_APOLLO?.trim().toLowerCase() === "live" && Boolean(process.env.APOLLO_API_KEY?.trim());

  // Draft links: Gmail opens a draft by its message id
  const readyIds = (leads ?? []).filter((l) => l.status === "draft_ready").map((l) => l.id);
  // gmail_message_id is a newer column than the generated types: read the whole row and narrow it here
  const { data: drafts } = readyIds.length
    ? await supabase.from("email_drafts").select("*, inboxes(email)").in("campaign_lead_id", readyIds).order("version", { ascending: false })
    : { data: [] };
  const draftOf = new Map<string, { messageId: string | null; email: string | null }>();
  for (const d of (drafts ?? []) as unknown as { campaign_lead_id: string; gmail_message_id?: string | null; inboxes: { email: string } | null }[]) {
    if (!draftOf.has(d.campaign_lead_id)) draftOf.set(d.campaign_lead_id, { messageId: d.gmail_message_id ?? null, email: d.inboxes?.email ?? null });
  }

  return (
    <>
      <PageHeader
        title="Leads"
        description="Bring in the people you want to write to: upload a CSV file, let Apollo find them, or find companies on Google. Then press Start run on Home."
        actions={
          <LinkButton href="/" icon={<Play aria-hidden />} data-testid="go-start-run">
            Go to Start run
          </LinkButton>
        }
      />
      <AutoRefresh active={Object.values(finds).some(isTestActive) || Object.values(webFinds).some(isTestActive) || Object.values(rechecks).some(isTestActive)} />

      <div className="space-y-8">
        {canAdd && (
          <div className="grid gap-5 xl:grid-cols-3">
            <Card className="space-y-4 p-5 sm:p-6" data-testid="card-csv">
              <div>
                <h2 className="text-lg font-semibold">Upload CSV</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">A spreadsheet of people you already have. Each row needs at least a name and an email or a website.</p>
              </div>
              <UploadForm campaigns={campaignList.map((c) => ({ id: c.id, name: c.name }))} />
              {!!uploads?.length && (
                <div className="border-t pt-4">
                  <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Recent uploads</p>
                  <ul className="space-y-1.5 text-sm" data-testid="recent-uploads">
                    {uploads.map((b) => {
                      const t = (b.totals ?? {}) as { imported?: number };
                      return (
                        <li key={b.id} data-testid="import-row" className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <Link href={`/import/${b.id}`} className="font-medium text-brand underline-offset-2 hover:underline">
                            {b.file_name}
                          </Link>
                          <span className="text-xs text-muted-foreground">
                            {b.campaigns?.name} · {b.status === "completed" ? (b.dry_run ? "preview only" : `${t.imported ?? 0} added`) : b.status}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </Card>

            <Card className="space-y-4 p-5 sm:p-6" data-testid="card-apollo">
              <div>
                <h2 className="text-lg font-semibold">Apollo search</h2>
                <p className="mt-0.5 text-sm text-muted-foreground" data-testid="apollo-optional-note">
                  You don&apos;t need this: Start run searches Apollo automatically for Apollo campaigns. Use the preview only to see who Apollo would find. It is free: no email credits are used.
                </p>
              </div>
              {!apolloLive && (
                <p data-testid="apollo-demo-note" className="rounded-lg border border-sky-200 bg-sky-50 px-3.5 py-2.5 text-sm text-sky-900">
                  Practice mode: Apollo is not connected yet, so the preview gives practice people. Add your Apollo key in{" "}
                  <Link href="/setup?tab=apollo" className="font-medium underline">
                    Setup &gt; Apollo
                  </Link>{" "}
                  to find real ones.
                </p>
              )}
              {apolloCampaigns.length ? (
                <FindApolloForm campaigns={apolloCampaigns.map((c) => ({ id: c.id, name: c.name }))} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  No campaign uses Apollo yet. In{" "}
                  <Link href="/setup?tab=campaigns" className="font-medium text-brand underline">
                    Setup &gt; Campaigns
                  </Link>{" "}
                  tick Apollo under &ldquo;Where the leads come from&rdquo;.
                </p>
              )}
              {apolloCampaigns.map((c) => {
                const line = findLine(finds[c.id]);
                return line ? (
                  <p key={c.id} data-testid={`find-result-${c.id}`} className={`text-sm ${line.tone === "error" ? "font-medium text-red-700" : line.tone === "ok" ? "text-emerald-800" : "text-muted-foreground"}`}>
                    <span className="font-medium">{c.name}:</span> {line.text}
                  </p>
                ) : null;
              })}
            </Card>

            <Card className="space-y-4 p-5 sm:p-6" data-testid="card-web">
              <div>
                <h2 className="text-lg font-semibold">Find companies on Google</h2>
                <p className="mt-0.5 text-sm text-muted-foreground" data-testid="web-optional-note">
                  Optional: Start run also searches Google automatically for campaigns with Web discovery. Preview adds the companies it finds to your leads now.
                </p>
              </div>
              {!apolloLive && (
                <p data-testid="web-demo-note" className="rounded-lg border border-sky-200 bg-sky-50 px-3.5 py-2.5 text-sm text-sky-900">
                  Apollo is not connected, so people cannot be found for the companies: they go to Needs attention as &ldquo;No contact found&rdquo;. Add your Apollo key in{" "}
                  <Link href="/setup?tab=apollo" className="font-medium underline">
                    Setup &gt; Apollo
                  </Link>
                  .
                </p>
              )}
              {webCampaigns.length ? (
                <FindWebForm campaigns={webCampaigns.map((c) => ({ id: c.id, name: c.name }))} />
              ) : (
                <div className="space-y-3" data-testid="web-empty">
                  <p className="text-sm text-muted-foreground">No campaign uses Web discovery yet. Tick &ldquo;Web discovery (Google)&rdquo; in a campaign to turn it on.</p>
                  <LinkButton href="/setup?tab=campaigns" variant="outline" size="sm">
                    Go to Setup &gt; Campaigns
                  </LinkButton>
                </div>
              )}
              {webCampaigns.map((c) => {
                const row = webFinds[c.id];
                const line = webLine(row);
                if (!line) return null;
                const companies = row?.result?.companies ?? [];
                return (
                  <div key={c.id} data-testid={`web-result-${c.id}`} className="space-y-2">
                    <p className={`text-sm ${line.tone === "error" ? "font-medium text-red-700" : line.tone === "ok" ? "text-emerald-800" : "text-muted-foreground"}`}>
                      <span className="font-medium">{c.name}:</span> {line.text}
                    </p>
                    {companies.length > 0 && (
                      <details className="rounded-xl border bg-background px-3.5 py-2.5 text-sm open:bg-card">
                        <summary className="cursor-pointer font-medium text-brand">Show the {companies.length} companies</summary>
                        <ul className="mt-3 space-y-2" data-testid="web-companies">
                          {companies.slice(0, 50).map((co) => (
                            <li key={co.domain} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                              <span className="min-w-0">
                                <a href={`https://${co.domain}`} target="_blank" rel="noreferrer" className="font-medium text-brand underline-offset-2 hover:underline">
                                  {co.name}
                                </a>{" "}
                                <span className="text-xs text-muted-foreground">{co.domain}</span>
                                <span className="block text-xs break-words text-muted-foreground">Found by: {co.query}</span>
                              </span>
                              <Badge tone={OUTCOME[co.outcome]?.tone ?? "neutral"}>{OUTCOME[co.outcome]?.label ?? co.outcome}</Badge>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                );
              })}
            </Card>
          </div>
        )}

        {canRecheck && recheckCampaigns.length > 0 && (
          <Card className="space-y-3 p-5 sm:p-6" data-testid="recheck-section">
            <div>
              <h2 className="text-lg font-semibold">Skipped at the quick check</h2>
              <p className="mt-0.5 text-sm text-muted-foreground" data-testid="recheck-help">
                Runs only the quick check again for leads that were skipped as not a good fit or because the website could not be read. Nothing else is repeated; leads that pass wait for the next Start run.
              </p>
            </div>
            <ul className="space-y-3">
              {recheckCampaigns.map((c) => {
                const row = rechecks[c.id];
                const active = isTestActive(row);
                const line = !row ? null : active ? (row.waitingTooLong ? "Waiting for the background worker. Is it running? (pnpm dev starts it.)" : "Checking the skipped leads…") : row.state === "failed" || !row.result ? `The re-check failed: ${row.error ?? "no answer from the background worker"}` : recheckLine(row.result);
                return (
                  <li key={c.id} className="space-y-1.5" data-testid={`recheck-${c.id}`}>
                    <div className="text-sm font-medium">{c.name}</div>
                    {(recheckable[c.id] ?? 0) > 0 ? <RecheckForm campaignId={c.id} count={recheckable[c.id]!} /> : <p className="text-sm text-muted-foreground">No skipped leads left to re-check.</p>}
                    {line && (
                      <p data-testid={`recheck-result-${c.id}`} className={`text-sm ${row?.state === "failed" ? "font-medium text-red-700" : row?.state === "done" ? "text-emerald-800" : "text-muted-foreground"}`}>
                        {line}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        <section data-testid="lead-list" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-lg font-semibold">Your leads</h2>
            <form method="get" className="flex items-end gap-2 text-sm">
              <label className="space-y-1">
                <span className="block text-xs font-medium text-muted-foreground">Campaign</span>
                <select name="campaign" defaultValue={campaignFilter ?? ""} className={`${inputClass} py-2 pr-9`}>
                  <option value="">All campaigns</option>
                  {campaignList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" variant="outline">
                Show
              </Button>
            </form>
          </div>
          {!leads?.length ? (
            <EmptyState>No leads yet. Upload a CSV, preview Apollo leads or find companies on Google above.</EmptyState>
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[64rem] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      <th scope="col" className="px-5 py-3">Person</th>
                      <th scope="col" className="px-3 py-3">Company</th>
                      <th scope="col" className="px-3 py-3">Campaign</th>
                      <th scope="col" className="px-3 py-3">Source</th>
                      <th scope="col" className="px-3 py-3">Found by</th>
                      <th scope="col" className="px-3 py-3">Quick check</th>
                      <th scope="col" className="px-3 py-3">Where it stands</th>
                      <th scope="col" className="px-5 py-3 text-right">Added (IST)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {leads.map((l) => {
                      const st = plainLeadStatus(l);
                      const qc = quickCheckOf(l.score_components);
                      const d = draftOf.get(l.id);
                      const company = l.contacts?.companies?.name ?? l.contacts?.company_name ?? l.contacts?.companies?.domain ?? null;
                      return (
                        <tr key={l.id} className="align-top transition-colors hover:bg-brand-soft" data-testid="lead-row">
                          <td className="px-5 py-3">
                            <div className="font-medium">{l.contacts?.full_name ?? <span className="text-muted-foreground">No person yet</span>}</div>
                            <div className="text-xs text-muted-foreground">
                              {l.contacts?.job_title} {l.contacts?.email ? `· ${l.contacts.email}` : ""}
                            </div>
                            {l.contacts?.email && (
                              <div className="mt-1 flex flex-wrap gap-1" data-testid="lead-email-status">
                                <Badge tone={emailStatusWords(l.contacts.email_status).tone}>{emailStatusWords(l.contacts.email_status).label}</Badge>
                                {hasEmailMismatch(l.score_components) && <Badge tone="amber">{EMAIL_MISMATCH_LABEL}</Badge>}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            <div>{company ?? "-"}</div>
                            {l.contacts?.companies?.domain && company !== l.contacts.companies.domain && <div className="text-xs text-muted-foreground">{l.contacts.companies.domain}</div>}
                          </td>
                          <td className="px-3 py-3">{l.campaigns?.name}</td>
                          <td className="px-3 py-3 whitespace-nowrap" data-testid="lead-source">{leadSourceLabel(l.lead_source)}</td>
                          <td className="max-w-56 px-3 py-3 text-xs break-words text-muted-foreground" data-testid="lead-found-by">{l.lead_source === "web_discovery" && l.source_detail ? l.source_detail : "-"}</td>
                          <td className="max-w-64 px-3 py-3" data-testid="lead-quick-check">
                            {qc ? (
                              <div className="space-y-0.5">
                                <Badge tone={qc.tone}>{qc.label}</Badge>
                                {qc.businessType && <div className="text-xs font-medium">{qc.businessType}</div>}
                                {qc.reason && <div className="text-xs break-words text-muted-foreground">{qc.reason}</div>}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="px-3 py-3" data-testid="lead-status">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge tone={st.tone}>{st.label}</Badge>
                              {l.status === "draft_ready" && d?.email && (
                                <a href={gmailDraftUrl(d.email, d.messageId)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-brand underline-offset-2 hover:underline">
                                  Open in Gmail
                                  <ExternalLink className="size-3" aria-hidden />
                                </a>
                              )}
                            </div>
                          </td>
                          <td className="px-5 py-3 text-right text-xs whitespace-nowrap text-muted-foreground">{formatKolkata(l.created_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </section>
      </div>
    </>
  );
}
