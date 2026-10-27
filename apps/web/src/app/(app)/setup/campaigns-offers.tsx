import { can, type Role } from "@outreach/core";
import { Section } from "@/components/bits";
import { LinkButton } from "@/components/link-button";
import { Badge, EmptyState } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { archiveCampaign } from "../campaigns/actions";
import { archiveOffer } from "../offers/actions";

const SOURCE_TEXT: Record<string, string> = { csv: "CSV file", apollo: "Apollo", both: "CSV file + Apollo" };
const STATUS_TEXT: Record<string, { text: string; tone: "green" | "amber" | "neutral" }> = {
  active: { text: "Active", tone: "green" },
  paused: { text: "Paused", tone: "amber" },
  draft: { text: "Draft", tone: "neutral" },
  completed: { text: "Finished", tone: "neutral" },
};

/** Setup > Campaign: who to target, where the leads come from, and which mailbox writes. */
export async function CampaignSection({ role }: { role: Role }) {
  const supabase = await createClient();
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, name, status, daily_cap, icp, offers(name), inboxes(email)")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  const manage = can(role, "campaign.manage");
  return (
    <Section id="campaign" title="Campaign" description="A campaign says who to write to (target), where the leads come from (CSV, Apollo or both), what you offer and which Gmail mailbox saves the drafts.">
      {manage && (
        <div>
          <LinkButton href="/campaigns/new" data-testid="new-campaign">New campaign</LinkButton>
        </div>
      )}
      {!campaigns?.length ? (
        <EmptyState>No campaign yet. Create one to get started.</EmptyState>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-zinc-500">
            <tr><th className="py-2">Name</th><th>Leads from</th><th>Status</th><th>Offer</th><th>Mailbox</th><th>Drafts a day</th><th /></tr>
          </thead>
          <tbody>
            {campaigns.map((c) => {
              const st = STATUS_TEXT[c.status] ?? { text: c.status, tone: "neutral" as const };
              return (
                <tr key={c.id} className="border-t" data-testid="campaign-row">
                  <td className="py-2 font-medium">{c.name}</td>
                  <td>{SOURCE_TEXT[(c.icp as { leadSource?: string } | null)?.leadSource ?? "csv"] ?? "CSV file"}</td>
                  <td><Badge tone={st.tone}>{st.text}</Badge></td>
                  <td>{c.offers?.name ?? "-"}</td>
                  <td>{c.inboxes?.email ?? "-"}</td>
                  <td>{c.daily_cap}</td>
                  <td className="flex justify-end gap-2 py-1">
                    {manage && (
                      <>
                        <LinkButton variant="outline" size="sm" href={`/campaigns/${c.id}`}>Edit</LinkButton>
                        <form action={archiveCampaign}>
                          <input type="hidden" name="id" value={c.id} />
                          <Button type="submit" variant="destructive" size="sm">Archive</Button>
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
    </Section>
  );
}

/** Setup > Offer: what you sell, the claims the emails may make, and the case studies they may quote. */
export async function OfferSection({ role }: { role: Role }) {
  const supabase = await createClient();
  const { data: offers } = await supabase
    .from("offers")
    .select("id, name, description, allowed_claims, case_studies(id, title, deleted_at)")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  const manage = can(role, "offer.manage");
  return (
    <Section id="offer" title="Offer and case study" description="The approved offer. Emails may only make the claims and quote the numbers listed here.">
      {manage && (
        <div>
          <LinkButton href="/offers/new" data-testid="new-offer">New offer</LinkButton>
        </div>
      )}
      {!offers?.length ? (
        <EmptyState>No offer yet. Add one so the emails know what you offer.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {offers.map((o) => {
            const studies = o.case_studies.filter((c) => !c.deleted_at);
            return (
              <li key={o.id} data-testid="offer-row" className="flex items-start justify-between gap-4 rounded-lg border p-4">
                <div>
                  <p className="font-medium">{o.name}</p>
                  {o.description && <p className="text-sm text-zinc-600 dark:text-zinc-400">{o.description}</p>}
                  <p className="mt-1 text-xs text-zinc-500">
                    {o.allowed_claims.length} allowed claims · {studies.length} case studies{studies.length ? `: ${studies.map((s) => s.title).join(", ")}` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <LinkButton variant="outline" size="sm" href={`/offers/${o.id}`}>{manage ? "Edit" : "View"}</LinkButton>
                  {manage && (
                    <form action={archiveOffer}>
                      <input type="hidden" name="id" value={o.id} />
                      <Button type="submit" variant="destructive" size="sm">Archive</Button>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
