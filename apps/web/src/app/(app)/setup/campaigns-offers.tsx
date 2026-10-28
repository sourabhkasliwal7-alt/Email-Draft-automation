import { Archive, BookOpen, Megaphone, Pencil } from "lucide-react";
import { can, sourcesOf, type Role } from "@outreach/core";
import { ConfirmButton } from "@/components/confirm";
import { LinkButton } from "@/components/link-button";
import { Badge, EmptyState } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { sourceShort } from "@/lib/web-queries";
import { hasDemoData, isDemoCampaign, isDemoCaseStudy, isDemoInbox, isDemoOffer } from "@/lib/demo-data";
import { createClient } from "@/lib/supabase/server";
import { archiveCampaign } from "../campaigns/actions";
import { archiveOffer } from "../offers/actions";
import { archiveDemoData } from "./actions";

const STATUS_TEXT: Record<string, { text: string; tone: "green" | "amber" | "neutral" }> = {
  active: { text: "Active", tone: "green" },
  paused: { text: "Paused", tone: "amber" },
  draft: { text: "Draft", tone: "neutral" },
  completed: { text: "Finished", tone: "neutral" },
};

/** How many own (non-demo) campaigns and offers exist: the numbers behind the green ticks on the tabs. */
export async function loadCampaignOfferFacts() {
  const supabase = await createClient();
  const [{ data: campaigns }, { data: offers }] = await Promise.all([
    supabase.from("campaigns").select("id, name").is("deleted_at", null),
    supabase.from("offers").select("id").is("deleted_at", null),
  ]);
  return { campaigns: (campaigns ?? []).filter((c) => !isDemoCampaign(c)).length, offers: (offers ?? []).filter((o) => !isDemoOffer(o)).length };
}

/** Setup > Campaigns: who to target, where the leads come from, and which mailbox saves the drafts. */
export async function CampaignsTab({ role }: { role: Role }) {
  const supabase = await createClient();
  const [{ data: campaigns }, { data: offerNames }] = await Promise.all([
    supabase.from("campaigns").select("id, name, status, daily_cap, icp, offer_id, offer_ids, inboxes(email)").is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("offers").select("id, name"),
  ]);
  const offerName = new Map((offerNames ?? []).map((o) => [o.id, o.name]));
  const manage = can(role, "campaign.manage");
  return (
    <div id="campaign" data-testid="section-campaign" className="space-y-4">
      {!campaigns?.length ? (
        <EmptyState icon={<Megaphone className="size-5" aria-hidden />} action={manage ? <LinkButton href="/campaigns/new">New campaign</LinkButton> : undefined}>
          No campaign yet. Create one to get started: it holds the people you write to and the offer you write about.
        </EmptyState>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  <th scope="col" className="px-5 py-3">Name</th>
                  <th scope="col" className="px-3 py-3">Leads from</th>
                  <th scope="col" className="px-3 py-3">Status</th>
                  <th scope="col" className="px-3 py-3">Offer</th>
                  <th scope="col" className="px-3 py-3">Mailbox</th>
                  <th scope="col" className="px-3 py-3 text-right">Drafts a day</th>
                  <th scope="col" className="px-5 py-3 text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {campaigns.map((c) => {
                  const st = STATUS_TEXT[c.status] ?? { text: c.status, tone: "neutral" as const };
                  return (
                    <tr key={c.id} className="transition-colors hover:bg-brand-soft" data-testid="campaign-row">
                      <td className="px-5 py-3 font-medium">
                        <span className="flex items-center gap-2">
                          {c.name}
                          {isDemoCampaign(c) && <Badge>Demo</Badge>}
                        </span>
                      </td>
                      <td className="px-3 py-3" data-testid="campaign-sources">
                        <span className="flex flex-wrap gap-1">
                          {sourcesOf(c.icp as { leadSources?: string[]; leadSource?: string } | null).map((s) => (
                            <Badge key={s}>{sourceShort(s)}</Badge>
                          ))}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={st.tone}>{st.text}</Badge>
                      </td>
                      <td className="px-3 py-3" data-testid="campaign-offers">
                        {c.offer_ids.length || c.offer_id ? (
                          <ul className="space-y-0.5">
                            {[...new Set([...(c.offer_id ? [c.offer_id] : []), ...c.offer_ids])].map((id) => (
                              <li key={id}>
                                {offerName.get(id) ?? "Archived offer"}
                                {id === c.offer_id && c.offer_ids.length > 1 && <span className="ml-1.5 text-xs text-muted-foreground">(default)</span>}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <Badge tone="amber">No offer selected</Badge>
                        )}
                      </td>
                      <td className="px-3 py-3">{c.inboxes?.email ?? <Badge tone="amber">No mailbox selected</Badge>}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{c.daily_cap}</td>
                      <td className="px-5 py-2.5">
                        {manage && (
                          <div className="flex justify-end gap-2">
                            <LinkButton variant="outline" size="sm" href={`/campaigns/${c.id}`} icon={<Pencil aria-hidden />}>
                              Edit
                            </LinkButton>
                            <form action={archiveCampaign}>
                              <input type="hidden" name="id" value={c.id} />
                              <ConfirmButton
                                variant="destructive"
                                size="sm"
                                icon={<Archive aria-hidden />}
                                confirm={{
                                  title: `Archive “${c.name}”?`,
                                  confirmLabel: "Archive",
                                  tone: "danger",
                                  body: <p>The campaign is hidden and stops running. Its leads and drafts are kept, nothing is deleted.</p>,
                                }}
                              >
                                Archive
                              </ConfirmButton>
                            </form>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

/** Setup > Offers: what you sell, the claims the emails may make, and the case studies they may quote. */
export async function OffersTab({ role }: { role: Role }) {
  const supabase = await createClient();
  const [{ data: offers }, { data: inboxes }, { data: campaigns }] = await Promise.all([
    supabase.from("offers").select("id, name, description, allowed_claims, case_studies(id, title, deleted_at)").is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("inboxes").select("id, email").is("deleted_at", null),
    supabase.from("campaigns").select("id, name").is("deleted_at", null),
  ]);
  const manage = can(role, "offer.manage");
  const canArchiveDemo = manage && can(role, "campaign.manage") && can(role, "inbox.manage");
  const demoLeft = hasDemoData({ offers: offers ?? [], inboxes: inboxes ?? [], campaigns: campaigns ?? [] });
  const demoParts = [
    (inboxes ?? []).some(isDemoInbox) && "the demo mailbox (demo-sender@example.com)",
    (campaigns ?? []).some(isDemoCampaign) && "the “Demo campaign”",
    (offers ?? []).some(isDemoOffer) && "the demo offers and their case studies",
  ].filter(Boolean);

  return (
    <div id="offer" data-testid="section-offer" className="space-y-4">
      {canArchiveDemo && demoLeft && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-dashed px-5 py-4" data-testid="demo-data-card">
          <p className="max-w-xl text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Sample data is still here.</span> The records marked Demo came with the app so you could look around. Archive them when you are ready to use your own.
          </p>
          <form action={archiveDemoData}>
            <ConfirmButton
              variant="outline"
              icon={<Archive aria-hidden />}
              data-testid="archive-demo"
              confirm={{
                title: "Archive the demo data?",
                confirmLabel: "Archive demo data",
                tone: "danger",
                body: (
                  <>
                    <p>This hides {demoParts.join(", ")}. Nothing is deleted, and your own records are not touched.</p>
                  </>
                ),
              }}
            >
              Archive demo data
            </ConfirmButton>
          </form>
        </Card>
      )}

      {!offers?.length ? (
        <EmptyState icon={<BookOpen className="size-5" aria-hidden />} action={manage ? <LinkButton href="/offers/new">New offer</LinkButton> : undefined}>
          No offer yet. Add one so the emails know what you offer and which claims they may make.
        </EmptyState>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {offers.map((o) => {
            const studies = o.case_studies.filter((c) => !c.deleted_at);
            return (
              <li key={o.id}>
                <Card data-testid="offer-row" className="flex h-full flex-col gap-4 p-5">
                  <div className="space-y-1.5">
                    <p className="flex flex-wrap items-center gap-2 text-base font-semibold">
                      {o.name}
                      {isDemoOffer(o) && <Badge>Demo</Badge>}
                    </p>
                    {o.description && <p className="text-sm text-muted-foreground">{o.description}</p>}
                    <p className="text-xs text-muted-foreground">
                      {o.allowed_claims.length} allowed claims · {studies.length} case studies
                    </p>
                  </div>
                  {studies.length > 0 && (
                    <ul className="space-y-1.5" aria-label="Case studies">
                      {studies.map((s) => (
                        <li key={s.id} className="flex items-center gap-2 rounded-lg bg-brand-soft px-3 py-2 text-sm">
                          <BookOpen className="size-4 shrink-0 text-brand" aria-hidden />
                          <span className="min-w-0 flex-1 truncate">{s.title}</span>
                          {isDemoCaseStudy(s) && <Badge>Demo</Badge>}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-auto flex justify-end gap-2 border-t pt-4">
                    <LinkButton variant="outline" size="sm" href={`/offers/${o.id}`} icon={<Pencil aria-hidden />}>
                      {manage ? "Edit" : "View"}
                    </LinkButton>
                    {manage && (
                      <form action={archiveOffer}>
                        <input type="hidden" name="id" value={o.id} />
                        <ConfirmButton
                          variant="destructive"
                          size="sm"
                          icon={<Archive aria-hidden />}
                          confirm={{
                            title: `Archive “${o.name}”?`,
                            confirmLabel: "Archive",
                            tone: "danger",
                            body: <p>The offer is hidden and cannot be chosen for new campaigns. Nothing is deleted.</p>,
                          }}
                        >
                          Archive
                        </ConfirmButton>
                      </form>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
