import { ExternalLink, Play } from "lucide-react";
import Link from "next/link";
import { can, formatKolkata } from "@outreach/core";
import { AutoRefresh } from "@/components/auto-refresh";
import { inputClass } from "@/components/form";
import { LinkButton } from "@/components/link-button";
import { Badge, EmptyState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { isTestActive, latestApolloFinds, type FindRow } from "@/lib/adapter-tests";
import { requireUser } from "@/lib/auth";
import { gmailDraftUrl, plainLeadStatus } from "@/lib/plain";
import { createClient } from "@/lib/supabase/server";
import { UploadForm } from "../import/forms";
import { FindApolloForm } from "./forms";

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

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ campaign?: string }> }) {
  const user = await requireUser("lead.view");
  const { campaign: campaignFilter } = await searchParams;
  const supabase = await createClient();
  const canAdd = can(user.role, "import.use");

  let query = supabase
    .from("campaign_leads")
    .select("id, status, next_action, reason_codes, lead_score, created_at, campaign_id, campaigns(name), contacts(full_name, job_title, email, companies(name, domain))")
    .order("created_at", { ascending: false })
    .limit(200);
  if (campaignFilter) query = query.eq("campaign_id", campaignFilter);
  const [{ data: leads }, { data: campaigns }, { data: uploads }, finds] = await Promise.all([
    query,
    supabase.from("campaigns").select("id, name, icp").is("deleted_at", null).order("name"),
    canAdd ? supabase.from("import_batches").select("id, file_name, status, dry_run, totals, created_at, campaigns(name)").order("created_at", { ascending: false }).limit(5) : Promise.resolve({ data: [] }),
    canAdd ? latestApolloFinds() : Promise.resolve({} as Record<string, FindRow>),
  ]);
  const campaignList = campaigns ?? [];
  const apolloCampaigns = campaignList.filter((c) => ["apollo", "both"].includes((c.icp as { leadSource?: string } | null)?.leadSource ?? "csv"));
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
        description="Bring in the people you want to write to: upload a CSV file, or let Apollo find them. Then press Start run on Home."
        actions={
          <LinkButton href="/" icon={<Play aria-hidden />} data-testid="go-start-run">
            Go to Start run
          </LinkButton>
        }
      />
      <AutoRefresh active={Object.values(finds).some(isTestActive)} />

      <div className="space-y-8">
        {canAdd && (
          <div className="grid gap-5 lg:grid-cols-2">
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
                  set the lead source to Apollo or Both.
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
          </div>
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
            <EmptyState>No leads yet. Upload a CSV or preview Apollo leads above.</EmptyState>
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[44rem] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      <th scope="col" className="px-5 py-3">Person</th>
                      <th scope="col" className="px-3 py-3">Company</th>
                      <th scope="col" className="px-3 py-3">Campaign</th>
                      <th scope="col" className="px-3 py-3">Where it stands</th>
                      <th scope="col" className="px-5 py-3 text-right">Added (IST)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {leads.map((l) => {
                      const st = plainLeadStatus(l);
                      const d = draftOf.get(l.id);
                      return (
                        <tr key={l.id} className="align-top transition-colors hover:bg-brand-soft" data-testid="lead-row">
                          <td className="px-5 py-3">
                            <div className="font-medium">{l.contacts?.full_name}</div>
                            <div className="text-xs text-muted-foreground">
                              {l.contacts?.job_title} {l.contacts?.email ? `· ${l.contacts.email}` : ""}
                            </div>
                          </td>
                          <td className="px-3 py-3">{l.contacts?.companies?.name ?? l.contacts?.companies?.domain}</td>
                          <td className="px-3 py-3">{l.campaigns?.name}</td>
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
