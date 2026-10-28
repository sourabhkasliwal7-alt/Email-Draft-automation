import { notFound } from "next/navigation";
import { icpSchema, sourcesOf } from "@outreach/core";
import { BackLink } from "@/components/bits";
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
    supabase.from("offers").select("id, name, match_terms, case_studies(title, deleted_at)").is("deleted_at", null).order("name"),
    supabase.from("inboxes").select("id, email").is("deleted_at", null).order("email"),
  ]);
  if (!c) notFound();

  const icp = icpSchema.parse(c.icp ?? {});
  const sources = sourcesOf(icp);
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
    researchFirst: sources.length === 1 && sources[0] === "csv" && !icp.requireEmail,
    leadSources: sources,
    webQueries: icp.webQueries.join("\n"),
    webMaxQueries: String(icp.webMaxQueries),
    webMaxResults: String(icp.webMaxResults),
    seniorities: icp.seniorities.join(", "),
    hiringTitles: icp.hiringTitles.join(", "),
    minOpenJobs: icp.minOpenJobs?.toString() ?? "",
    targetRoles: c.target_roles.join(", "),
    regions: c.regions.join(", "),
    scoreDraftMin: c.score_draft_min,
    scoreReviewMin: c.score_review_min,
    dailyCap: c.daily_cap,
    // a campaign saved before several offers existed has only offer_id: it becomes the one offer and the default
    offerIds: [...new Set([...c.offer_ids, ...(c.offer_id ? [c.offer_id] : [])])],
    offerId: c.offer_id ?? c.offer_ids[0] ?? "",
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
      <BackLink href="/setup?tab=campaigns">Setup</BackLink>
      <PageHeader
        title={`Edit: ${c.name}`}
        description="Change who to write to, where the leads come from and where the drafts go."
      />
      <div className="py-6">
        <CampaignForm
          defaults={defaults}
          offers={(offers ?? []).map((o) => ({
            id: o.id,
            name: o.name,
            matchTerms: o.match_terms,
            caseStudies: o.case_studies.filter((x) => !x.deleted_at).map((x) => x.title),
          }))}
          inboxes={inboxes ?? []}
        />
      </div>
    </>
  );
}
