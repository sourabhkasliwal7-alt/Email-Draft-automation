import { Archive, BookOpen, Pencil } from "lucide-react";
import { notFound } from "next/navigation";
import { can } from "@outreach/core";
import { BackLink } from "@/components/bits";
import { PageHeader, EmptyState } from "@/components/page-header";
import { LinkButton } from "@/components/link-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
      <BackLink href="/setup?tab=offers">Setup</BackLink>
      <PageHeader title={offer.name} description={manage ? "Edit the offer and its case studies." : "Read-only view."} />
      <div className="space-y-8 py-6">
        {manage ? (
          <OfferForm offer={offer} />
        ) : (
          <Card className="max-w-3xl">
            <CardHeader>
              <div>
                <CardTitle>What the emails may say</CardTitle>
                <CardDescription>{offer.description ?? "The claims listed on this offer."}</CardDescription>
              </div>
            </CardHeader>
            <CardBody>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {offer.allowed_claims.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}

        <section className="max-w-3xl space-y-3" aria-labelledby="case-studies-title">
          <div>
            <h2 id="case-studies-title" className="text-lg font-semibold">
              Case studies
            </h2>
            <p className="text-sm text-muted-foreground">Real results the emails may point to. Only the figures listed on each one can be quoted.</p>
          </div>
          {!studies?.length ? (
            <EmptyState icon={<BookOpen className="size-5" aria-hidden />}>No case studies yet.{manage ? " Add one below so emails can point to a real result." : ""}</EmptyState>
          ) : (
            <ul className="space-y-2.5">
              {studies.map((s) => {
                const numbers = Object.entries(s.allowed_numbers as Record<string, number>);
                return (
                  <li key={s.id} data-testid="case-study-row" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4 text-sm shadow-card">
                    <div className="min-w-0 space-y-1.5">
                      <p className="font-medium">{s.title}</p>
                      {numbers.length ? (
                        <div className="flex flex-wrap gap-1.5">
                          {numbers.map(([k, v]) => (
                            <Badge key={k}>{`${k}: ${v}`}</Badge>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">no allowed numbers</p>
                      )}
                    </div>
                    {manage && (
                      <div className="flex gap-2">
                        <LinkButton variant="outline" size="sm" href={`/offers/${id}?edit=${s.id}`} icon={<Pencil aria-hidden />}>
                          Edit
                        </LinkButton>
                        <form action={archiveCaseStudy}>
                          <input type="hidden" name="id" value={s.id} />
                          <Button type="submit" variant="destructive" size="sm" icon={<Archive aria-hidden />}>
                            Archive
                          </Button>
                        </form>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {manage && <CaseStudyForm key={editing?.id ?? "new"} offerId={id} study={editing && { ...editing, allowed_numbers: editing.allowed_numbers as Record<string, number> }} />}
      </div>
    </>
  );
}
