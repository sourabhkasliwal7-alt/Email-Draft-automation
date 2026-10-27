import { notFound } from "next/navigation";
import { can } from "@outreach/core";
import { BackLink } from "@/components/bits";
import { PageHeader } from "@/components/page-header";
import { LinkButton } from "@/components/link-button";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { archiveCaseStudy } from "../actions";
import { CaseStudyForm, OfferForm } from "../forms";

export default async function OfferPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const user = await requireUser("offer.view");
  const [{ id }, { edit }] = await Promise.all([params, searchParams]);
  const supabase = await createClient();
  const [{ data: offer }, { data: studies }] = await Promise.all([
    supabase.from("offers").select("*").eq("id", id).is("deleted_at", null).maybeSingle(),
    supabase.from("case_studies").select("*").eq("offer_id", id).is("deleted_at", null).order("created_at"),
  ]);
  if (!offer) notFound();
  const manage = can(user.role, "offer.manage");
  const editing = studies?.find((s) => s.id === edit);

  return (
    <>
      <BackLink href="/setup#offer">Setup</BackLink>
      <PageHeader title={offer.name} description={manage ? "Edit the offer and its case studies." : "Read-only view."} />
      {manage ? (
        <OfferForm offer={offer} />
      ) : (
        <ul className="list-disc pl-5 text-sm">
          {offer.allowed_claims.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}

      <h2 className="mb-3 mt-10 text-lg font-semibold">Case studies</h2>
      {!studies?.length ? (
        <p className="text-sm text-zinc-500">No case studies yet.</p>
      ) : (
        <ul className="mb-6 space-y-2">
          {studies.map((s) => (
            <li key={s.id} data-testid="case-study-row" className="flex items-center justify-between rounded-md border p-3 text-sm">
              <div>
                <p className="font-medium">{s.title}</p>
                <p className="text-xs text-zinc-500">
                  {Object.entries(s.allowed_numbers as Record<string, number>)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(" · ") || "no allowed numbers"}
                </p>
              </div>
              {manage && (
                <div className="flex gap-2">
                  <LinkButton variant="outline" size="sm" href={`/offers/${id}?edit=${s.id}`}>
                    Edit
                  </LinkButton>
                  <form action={archiveCaseStudy}>
                    <input type="hidden" name="id" value={s.id} />
                    <Button type="submit" variant="destructive" size="sm">
                      Archive
                    </Button>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {manage && (
        <>
          <h3 className="mb-3 font-medium">{editing ? "Edit case study" : "Add a case study"}</h3>
          <CaseStudyForm
            key={editing?.id ?? "new"}
            offerId={id}
            study={editing && { ...editing, allowed_numbers: editing.allowed_numbers as Record<string, number> }}
          />
        </>
      )}
    </>
  );
}
