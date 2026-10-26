import { can } from "@outreach/core";
import { Badge, EmptyState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/link-button";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { archiveCampaign } from "./actions";

export default async function CampaignsPage() {
  const user = await requireUser("campaign.view");
  const supabase = await createClient();
  const { data: campaigns, error } = await supabase
    .from("campaigns")
    .select("id, name, status, daily_cap, score_draft_min, score_review_min, research_depth, offers(name), inboxes(email)")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  const manage = can(user.role, "campaign.manage");

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Each campaign has its own audience, thresholds, offer, inbox and send window."
        actions={manage && <LinkButton href="/campaigns/new">New campaign</LinkButton>}
      />
      {error && <p role="alert" className="text-sm text-red-600">{error.message}</p>}
      {!campaigns?.length ? (
        <EmptyState>No campaigns yet.</EmptyState>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-zinc-500">
            <tr>
              <th className="py-2">Name</th>
              <th>Status</th>
              <th>Offer</th>
              <th>Inbox</th>
              <th>Thresholds</th>
              <th>Daily cap</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.id} className="border-t" data-testid="campaign-row">
                <td className="py-2 font-medium">{c.name}</td>
                <td>
                  <Badge tone={c.status === "active" ? "green" : c.status === "paused" ? "amber" : "neutral"}>{c.status}</Badge>
                </td>
                <td>{c.offers?.name ?? "-"}</td>
                <td>{c.inboxes?.email ?? "-"}</td>
                <td>
                  draft {c.score_draft_min} / review {c.score_review_min}
                </td>
                <td>{c.daily_cap}</td>
                <td className="flex justify-end gap-2 py-1">
                  {manage && (
                    <>
                      <LinkButton variant="outline" size="sm" href={`/campaigns/${c.id}`}>
                        Edit
                      </LinkButton>
                      <form action={archiveCampaign}>
                        <input type="hidden" name="id" value={c.id} />
                        <Button type="submit" variant="destructive" size="sm">
                          Archive
                        </Button>
                      </form>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
