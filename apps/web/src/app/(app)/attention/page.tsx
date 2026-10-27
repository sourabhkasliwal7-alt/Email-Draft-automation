import { ATTENTION_REASONS, SKIP_LABELS, can, type SkipReason } from "@outreach/core";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { markDncAction, skipLeadAction } from "./actions";

export default async function AttentionPage() {
  const user = await requireUser("attention.view");
  const supabase = await createClient();
  const { data: found } = await supabase
    .from("campaign_leads")
    .select("id, status, reason_codes, lead_score, updated_at, campaigns(name), contacts(full_name, job_title, company_name)")
    .in("status", ["disqualified", "approved"])
    .overlaps("reason_codes", [...ATTENTION_REASONS])
    .order("updated_at", { ascending: false })
    .limit(200);
  const leads = (found ?? []).filter((l) => ATTENTION_REASONS.includes(l.reason_codes[0] as SkipReason)).slice(0, 100);
  const act = can(user.role, "lead.mark_dnc");
  return (
    <>
      <PageHeader title="Needs attention" description="Leads the automatic checks could not finish. Everything that passed is already a Gmail draft." />
      {!leads.length ? (
        <EmptyState>Nothing needs attention.</EmptyState>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-zinc-500">
            <tr>
              <th className="py-2">Lead</th>
              <th>Campaign</th>
              <th>Score</th>
              <th>What happened</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => {
              const reason = l.reason_codes[0] as SkipReason;
              return (
                <tr key={l.id} className="border-t align-top" data-testid="attention-row">
                  <td className="py-2">
                    <div className="font-medium">{l.contacts?.full_name}</div>
                    <div className="text-xs text-zinc-500">
                      {l.contacts?.job_title} · {l.contacts?.company_name}
                    </div>
                  </td>
                  <td>{l.campaigns?.name}</td>
                  <td>{l.lead_score ?? "-"}</td>
                  <td className="max-w-md">
                    <div>{SKIP_LABELS[reason] ?? reason}</div>
                    {l.reason_codes[1] && <div className="break-words text-xs text-zinc-500">{l.reason_codes[1]}</div>}
                  </td>
                  <td className="flex justify-end gap-2 py-1">
                    {act && (
                      <>
                        <form action={skipLeadAction}>
                          <input type="hidden" name="id" value={l.id} />
                          <Button type="submit" variant="outline" size="sm">
                            Skip
                          </Button>
                        </form>
                        <form action={markDncAction}>
                          <input type="hidden" name="id" value={l.id} />
                          <Button type="submit" variant="destructive" size="sm">
                            Do not contact
                          </Button>
                        </form>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
