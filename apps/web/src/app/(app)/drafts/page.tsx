import { CheckCircle2, ExternalLink, Mail } from "lucide-react";
import Link from "next/link";
import { ATTENTION_REASONS, can, formatKolkata, type SkipReason } from "@outreach/core";
import { LinkButton } from "@/components/link-button";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { DRAFT_NOTICES } from "@/lib/notices";
import { gmailDraftUrl, gmailDraftsUrl, plainDetail, plainReason } from "@/lib/plain";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { AttentionButtons } from "./forms";

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

  const firstMailbox = drafts.find((d) => d.inboxes?.email)?.inboxes?.email;
  const tabClass = (on: boolean) =>
    cn("inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors", on ? "bg-brand text-white shadow-sm" : "text-zinc-600 hover:bg-muted hover:text-foreground");

  return (
    <>
      <PageHeader
        title="Drafts"
        description="The emails written for you are saved in Gmail as drafts: read them, edit them and send them yourself. Nothing is sent from here."
        actions={
          firstMailbox ? (
            <LinkButton href={gmailDraftsUrl(firstMailbox)} external icon={<Mail aria-hidden />} data-testid="open-gmail-drafts">
              Open Gmail drafts
            </LinkButton>
          ) : undefined
        }
      />

      <div className="space-y-5">
        <div className="inline-flex gap-1 rounded-xl border bg-card p-1 shadow-card" role="tablist" aria-label="Drafts views">
          <Link href="/drafts" role="tab" aria-selected={!showAttention} data-testid="tab-drafts" className={tabClass(!showAttention)}>
            Drafts created
          </Link>
          {canAttention && (
            <Link href="/drafts?tab=attention" role="tab" aria-selected={showAttention} data-testid="tab-attention" className={tabClass(showAttention)}>
              Needs attention ({attention.length})
            </Link>
          )}
        </div>

        {showAttention && notice && DRAFT_NOTICES[notice] && (
          <p role="status" data-testid="notice" className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
            {DRAFT_NOTICES[notice]}
          </p>
        )}

        {!showAttention ? (
          !drafts.length ? (
            <EmptyState icon={<Mail className="size-5" aria-hidden />}>No drafts yet. Press Start run on Home and the emails appear here.</EmptyState>
          ) : (
            <ul className="space-y-3" data-testid="draft-list">
              {drafts.map((d) => {
                const c = d.campaign_leads.contacts;
                return (
                  <li key={d.id}>
                    <Card className="p-4 sm:p-5" data-testid="draft-row">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{c?.company_name}</p>
                          <p className="text-base font-semibold">{d.subject}</p>
                          <p className="text-sm text-muted-foreground">
                            To {c?.full_name} ({c?.job_title}) &lt;{c?.email}&gt;
                          </p>
                          <p className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
                            <Badge tone="green">Score {d.campaign_leads.lead_score ?? "-"}</Badge>
                            <span>Email quality {d.quality_score ?? "-"}%</span>
                            <span>· {d.campaign_leads.campaigns?.name}</span>
                            <span>· {formatKolkata(d.created_at)}</span>
                          </p>
                        </div>
                        {d.inboxes?.email && (
                          <LinkButton href={gmailDraftUrl(d.inboxes.email, d.gmail_message_id)} external variant="outline" size="sm" icon={<ExternalLink aria-hidden />} data-testid="open-in-gmail">
                            Open in Gmail
                          </LinkButton>
                        )}
                      </div>
                      <details className="group mt-3 border-t pt-3">
                        <summary className="cursor-pointer text-sm font-medium text-brand">Read the email</summary>
                        <pre className="mt-3 rounded-lg bg-muted/60 p-4 font-sans text-sm whitespace-pre-wrap">{d.body_text}</pre>
                      </details>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )
        ) : !attention.length ? (
          <EmptyState icon={<CheckCircle2 className="size-5" aria-hidden />}>Nothing needs attention. Leads that could not get a draft show up here with the reason and what to do.</EmptyState>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-sm" data-testid="attention-table">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    <th scope="col" className="px-5 py-3">Company and person</th>
                    <th scope="col" className="px-3 py-3">Campaign</th>
                    <th scope="col" className="px-3 py-3 text-right">Score</th>
                    <th scope="col" className="px-3 py-3">What happened</th>
                    <th scope="col" className="px-5 py-3 text-right">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {attention.map((l) => {
                    const reason = l.reason_codes[0] as SkipReason;
                    const detail = plainDetail(reason, l.reason_codes[1]);
                    return (
                      <tr key={l.id} className="align-top transition-colors hover:bg-brand-soft" data-testid="attention-row">
                        <td className="px-5 py-3">
                          <div className="font-medium">{l.contacts?.company_name}</div>
                          <div className="text-xs text-muted-foreground">
                            {l.contacts?.full_name} · {l.contacts?.job_title}
                          </div>
                        </td>
                        <td className="px-3 py-3">{l.campaigns?.name}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{l.lead_score ?? "-"}</td>
                        <td className="max-w-md px-3 py-3">
                          <div data-testid="attention-reason">{plainReason(reason)}</div>
                          {detail && (
                            <div className="text-xs break-words text-muted-foreground" data-testid="attention-detail">
                              {detail}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3">{act && <AttentionButtons leadId={l.id} company={l.contacts?.company_name} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
