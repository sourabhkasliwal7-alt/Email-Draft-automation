import { notFound } from "next/navigation";
import { icpSchema } from "@outreach/core";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CampaignForm, type CampaignDefaults } from "../campaign-form";

export default async function EditCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("campaign.manage");
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: c }, { data: offers }, { data: inboxes }] = await Promise.all([
    supabase.from("campaigns").select("*").eq("id", id).is("deleted_at", null).maybeSingle(),
    supabase.from("offers").select("id, name").is("deleted_at", null).order("name"),
    supabase.from("inboxes").select("id, email").is("deleted_at", null).order("email"),
  ]);
  if (!c) notFound();

  const icp = icpSchema.parse(c.icp ?? {});
  const win = (c.send_window ?? {}) as { days?: number[]; start?: string; end?: string };
  const defaults: CampaignDefaults = {
    id: c.id,
    name: c.name,
    industries: icp.industries.join(", "),
    excludeIndustries: icp.excludeIndustries.join(", "),
    countries: icp.countries.join(", "),
    employeeMin: icp.employeeMin?.toString() ?? "",
    employeeMax: icp.employeeMax?.toString() ?? "",
    keywordsInclude: icp.keywordsInclude.join(", "),
    keywordsExclude: icp.keywordsExclude.join(", "),
    researchFirst: !icp.requireEmail && icp.leadSource !== "apollo",
    leadSource: icp.leadSource,
    targetRoles: c.target_roles.join(", "),
    regions: c.regions.join(", "),
    scoreDraftMin: c.score_draft_min,
    scoreReviewMin: c.score_review_min,
    dailyCap: c.daily_cap,
    offerId: c.offer_id ?? "",
    tone: c.tone ?? "",
    cta: c.cta ?? "",
    inboxId: c.inbox_id ?? "",
    researchDepth: c.research_depth,
    sendDays: win.days ?? [1, 2, 3, 4, 5],
    sendStart: win.start ?? "10:00",
    sendEnd: win.end ?? "17:00",
    status: c.status,
  };
  return (
    <>
      <PageHeader title={`Edit: ${c.name}`} />
      <CampaignForm defaults={defaults} offers={offers ?? []} inboxes={inboxes ?? []} />
    </>
  );
}
