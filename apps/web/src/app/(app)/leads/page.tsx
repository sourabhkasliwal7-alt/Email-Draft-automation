import Link from "next/link";
import { can, formatKolkata } from "@outreach/core";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge, EmptyState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
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
      <PageHeader title="Leads" description="Bring in the people you want to write to: upload a file, or let Apollo find them. Then start a run on Home." />
      <AutoRefresh active={Object.values(finds).some(isTestActive)} />

      {canAdd && (
        <div className="mb-8 grid gap-4 lg:grid-cols-2">
          <section className="space-y-3 rounded-lg border p-4" data-testid="card-csv">
            <h2 className="text-lg font-semibold">Upload CSV</h2>
            <UploadForm campaigns={campaignList.map((c) => ({ id: c.id, name: c.name }))} />
            {!!uploads?.length && (
              <div className="border-t pt-3">
                <p className="mb-1 text-xs font-medium text-zinc-500">Recent uploads</p>
                <ul className="space-y-1 text-sm" data-testid="recent-uploads">
                  {uploads.map((b) => {
                    const t = (b.totals ?? {}) as { imported?: number };
                    return (
                      <li key={b.id} data-testid="import-row">
                        <Link href={`/import/${b.id}`} className="underline underline-offset-2">{b.file_name}</Link>{" "}
                        <span className="text-xs text-zinc-500">
                          {b.campaigns?.name} · {b.status === "completed" ? (b.dry_run ? "preview only" : `${t.imported ?? 0} added`) : b.status}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </section>

          <section className="space-y-3 rounded-lg border p-4" data-testid="card-apollo">
            <h2 className="text-lg font-semibold">Find leads with Apollo</h2>
            <p className="text-xs text-zinc-500">Searches Apollo for people who match the campaign&apos;s target. The search is free: it does not use any email credits. Email addresses are only unlocked later, for leads that pass the checks.</p>
            {!apolloLive && (
              <p data-testid="apollo-demo-note" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                Apollo is not connected yet, so the search gives practice (demo) people. Add your Apollo key in Setup &gt; Apollo account to find real ones.
              </p>
            )}
            {apolloCampaigns.length ? (
              <FindApolloForm campaigns={apolloCampaigns.map((c) => ({ id: c.id, name: c.name }))} />
            ) : (
              <p className="text-sm text-zinc-500">
                No campaign uses Apollo yet. In <Link href="/setup#campaign" className="underline">Setup &gt; Campaign</Link> set the lead source to Apollo or Both.
              </p>
            )}
            {apolloCampaigns.map((c) => {
              const line = findLine(finds[c.id]);
              return line ? (
                <p key={c.id} data-testid={`find-result-${c.id}`} className={`text-sm ${line.tone === "error" ? "font-medium text-red-700" : line.tone === "ok" ? "text-emerald-800" : "text-zinc-600"}`}>
                  <span className="font-medium">{c.name}:</span> {line.text}
                </p>
              ) : null;
            })}
          </section>
        </div>
      )}

      <section data-testid="lead-list">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg font-semibold">Your leads</h2>
          <form method="get" className="flex items-end gap-2 text-sm">
            <label className="space-y-1">
              <span className="block text-xs font-medium">Campaign</span>
              <select name="campaign" defaultValue={campaignFilter ?? ""} className="rounded-md border px-2 py-1.5">
                <option value="">All campaigns</option>
                {campaignList.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="outline" size="sm">Show</Button>
          </form>
        </div>
        {!leads?.length ? (
          <EmptyState>No leads yet. Upload a CSV or find leads with Apollo above.</EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-zinc-500">
              <tr><th className="py-2">Person</th><th>Company</th><th>Campaign</th><th>Where it stands</th><th>Added (IST)</th></tr>
            </thead>
            <tbody>
              {leads.map((l) => {
                const st = plainLeadStatus(l);
                const d = draftOf.get(l.id);
                return (
                  <tr key={l.id} className="border-t align-top" data-testid="lead-row">
                    <td className="py-2">
                      <div className="font-medium">{l.contacts?.full_name}</div>
                      <div className="text-xs text-zinc-500">{l.contacts?.job_title} {l.contacts?.email ? `· ${l.contacts.email}` : ""}</div>
                    </td>
                    <td>{l.contacts?.companies?.name ?? l.contacts?.companies?.domain}</td>
                    <td>{l.campaigns?.name}</td>
                    <td data-testid="lead-status">
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {l.status === "draft_ready" && d?.email && (
                        <a href={gmailDraftUrl(d.email, d.messageId)} target="_blank" rel="noreferrer" className="ml-2 text-xs underline underline-offset-2">Open in Gmail</a>
                      )}
                    </td>
                    <td className="text-xs text-zinc-500">{formatKolkata(l.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
