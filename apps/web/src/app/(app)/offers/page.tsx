import { can } from "@outreach/core";
import { EmptyState, PageHeader } from "@/components/page-header";
import { LinkButton } from "@/components/link-button";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { archiveOffer } from "./actions";

export default async function OffersPage() {
  const user = await requireUser("offer.view");
  const supabase = await createClient();
  const { data: offers } = await supabase
    .from("offers")
    .select("id, name, description, allowed_claims, case_studies(id, deleted_at)")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  const manage = can(user.role, "offer.manage");
  return (
    <>
      <PageHeader
        title="Offers"
        description="The approved offer library. Drafts can only use claims and numbers listed here."
        actions={manage && <LinkButton href="/offers/new">New offer</LinkButton>}
      />
      {!offers?.length ? (
        <EmptyState>No offers yet.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {offers.map((o) => (
            <li key={o.id} data-testid="offer-row" className="flex items-start justify-between gap-4 rounded-lg border p-4">
              <div>
                <p className="font-medium">{o.name}</p>
                {o.description && <p className="text-sm text-zinc-600 dark:text-zinc-400">{o.description}</p>}
                <p className="mt-1 text-xs text-zinc-500">
                  {o.allowed_claims.length} allowed claims · {o.case_studies.filter((c) => !c.deleted_at).length} case studies
                </p>
              </div>
              <div className="flex gap-2">
                <LinkButton variant="outline" size="sm" href={`/offers/${o.id}`}>
                  {manage ? "Edit" : "View"}
                </LinkButton>
                {manage && (
                  <form action={archiveOffer}>
                    <input type="hidden" name="id" value={o.id} />
                    <Button type="submit" variant="destructive" size="sm">
                      Archive
                    </Button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
