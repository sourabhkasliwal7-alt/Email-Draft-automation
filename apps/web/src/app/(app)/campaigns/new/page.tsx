import { BackLink } from "@/components/bits";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CampaignForm, NEW_CAMPAIGN } from "../campaign-form";

export default async function NewCampaignPage() {
  await requireUser("campaign.manage");
  const supabase = await createClient();
  const [{ data: offers }, { data: inboxes }] = await Promise.all([
    supabase.from("offers").select("id, name, match_terms, case_studies(title, deleted_at)").is("deleted_at", null).order("name"),
    supabase.from("inboxes").select("id, email").is("deleted_at", null).order("email"),
  ]);
  return (
    <>
      <BackLink href="/setup?tab=campaigns">Setup</BackLink>
      <PageHeader
        title="New campaign"
        description="Who to write to, where the leads come from and where the drafts go."
      />
      <div className="py-6">
        <CampaignForm
          defaults={NEW_CAMPAIGN}
          offers={(offers ?? []).map((o) => ({
            id: o.id,
            name: o.name,
            matchTerms: o.match_terms,
            caseStudies: o.case_studies.filter((c) => !c.deleted_at).map((c) => c.title),
          }))}
          inboxes={inboxes ?? []}
        />
      </div>
    </>
  );
}
