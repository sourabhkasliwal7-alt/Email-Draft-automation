import Link from "next/link";
import { ATTENTION_REASONS, can, formatKolkata, type SkipReason } from "@outreach/core";
import { EmptyState, PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { gmailDraftUrl, plainDetail, plainReason } from "@/lib/plain";
import { createClient } from "@/lib/supabase/server";
import { AttentionButtons } from "./forms";

const NOTICES: Record<string, string> = {
  retry_running: "Done. The lead is back at the step that failed and will continue in the current run. Nothing that already ran is repeated.",
  retry_paused: "The lead is back at the step that failed, but this campaign has a paused run. Resume or cancel that run on Home first, then it continues.",
  retry_started: "Done. The lead is back at the step that failed and a run has started: watch it on Home. Nothing that already ran is repeated.",
};

export default async function DraftsPage({ searchParams }: { searchParams: Promise<{ tab?: string; notice?: string }> }) {
  const user = await requireUser("drafts.view");
  const { tab, notice } = await searchParams;
  const supabase = await createClient();
  const canAttention = can(user.role, "attention.view");
  const showAttention = canAttention && tab === "attention";
  const act = can(user.role, "lead.mark_dnc");

  // the count is always shown, the list only for the tab that is open
  const { data: attentionRows } = canAttention
    ? await supabase
        .from("campaign_leads")
        .select("id, status, reason_codes, lead_score, updated_at, campaigns(name), contacts(full_name, job_title, company_name)")
        .overlaps("reason_codes", [...ATTENTION_REASONS])
        .order("updated_at", { ascending: false })
        .limit(200)
    : { data: [] };
  const attention = (attentionRows ?? []).filter((l) => ATTENTION_REASONS.includes(l.reason_codes[0] as SkipReason));

  // gmail_message_id is newer than the generated types: read whole rows and narrow them here
  const { data: draftRows } = showAttention
    ? { data: [] }
    : await supabase
        .from("email_drafts")
        .select("*, inboxes(email), campaign_leads!inner(lead_score, campaigns(name), contacts(full_name, email, job_title, company_name))")
        .not("gmail_draft_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(100);
  const drafts = (draftRows ?? []) as unknown as {
    id: string;
    subject: string;
    body_text: string;
    quality_score: number | null;
    created_at: string;
    gmail_draft_id: string | null;
    gmail_message_id?: string | null;
    inboxes: { email: string } | null;
    campaign_leads: { lead_score: number | null; campaigns: { name: string } | null; contacts: { full_name: string | null; email: string | null; job_title: string | null; company_name: string | null } | null };
  }[];

  const tabClass = (on: boolean) => `rounded-md px-3 py-1.5 text-sm font-medium ${on ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border"}`;

  return (
    <>
      <PageHeader title="Drafts" description="The emails written for you. They are saved in Gmail as drafts: you read them, edit them and send them yourself. Nothing is sent from here." />
      <div className="mb-5 flex gap-2" role="tablist" aria-label="Drafts views">
        <Link href="/drafts" role="tab" aria-selected={!showAttention} data-testid="tab-drafts" className={tabClass(!showAttention)}>Drafts</Link>
        {canAttention && (
          <Link href="/drafts?tab=attention" role="tab" aria-selected={showAttention} data-testid="tab-attention" className={tabClass(showAttention)}>
            Needs attention ({attention.length})
          </Link>
        )}
      </div>

      {showAttention && notice && NOTICES[notice] && (
        <p role="status" data-testid="notice" className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{NOTICES[notice]}</p>
      )}

      {!showAttention ? (
        !drafts.length ? (
          <EmptyState>No drafts yet. Start a run on Home and the emails appear here.</EmptyState>
        ) : (
          <ul className="max-w-5xl space-y-2" data-testid="draft-list">
            {drafts.map((d) => {
              const c = d.campaign_leads.contacts;
              return (
                <li key={d.id} className="rounded-lg border p-3 text-sm" data-testid="draft-row">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{d.subject}</p>
                      <p className="text-zinc-600">
                        To {c?.full_name} ({c?.job_title}, {c?.company_name}) &lt;{c?.email}&gt;
                      </p>
                      <p className="text-xs text-zinc-500">
                        {d.campaign_leads.campaigns?.name} · lead score {d.campaign_leads.lead_score ?? "-"} · email quality {d.quality_score ?? "-"}% · {formatKolkata(d.created_at)}
                      </p>
                    </div>
                    {d.inboxes?.email && (
                      <a href={gmailDraftUrl(d.inboxes.email, d.gmail_message_id)} target="_blank" rel="noreferrer" data-testid="open-in-gmail" className="shrink-0 rounded-md border px-3 py-1.5 text-sm font-medium">
                        Open in Gmail
                      </a>
                    )}
                  </div>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-zinc-600">Read the email</summary>
                    <pre className="mt-2 whitespace-pre-wrap rounded-md bg-zinc-50 p-3 font-sans text-sm dark:bg-zinc-900">{d.body_text}</pre>
                  </details>
                </li>
              );
            })}
          </ul>
        )
      ) : !attention.length ? (
        <EmptyState>Nothing needs attention.</EmptyState>
      ) : (
        <table className="w-full text-sm" data-testid="attention-table">
          <thead className="text-left text-xs uppercase text-zinc-500">
            <tr><th className="py-2">Person</th><th>Campaign</th><th>What happened</th><th /></tr>
          </thead>
          <tbody>
            {attention.map((l) => {
              const reason = l.reason_codes[0] as SkipReason;
              const detail = plainDetail(reason, l.reason_codes[1]);
              return (
                <tr key={l.id} className="border-t align-top" data-testid="attention-row">
                  <td className="py-2">
                    <div className="font-medium">{l.contacts?.full_name}</div>
                    <div className="text-xs text-zinc-500">{l.contacts?.job_title} · {l.contacts?.company_name}</div>
                  </td>
                  <td>{l.campaigns?.name}</td>
                  <td className="max-w-md">
                    <div data-testid="attention-reason">{plainReason(reason)}</div>
                    {detail && <div className="break-words text-xs text-zinc-500" data-testid="attention-detail">{detail}</div>}
                  </td>
                  <td className="py-1">{act && <AttentionButtons leadId={l.id} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
