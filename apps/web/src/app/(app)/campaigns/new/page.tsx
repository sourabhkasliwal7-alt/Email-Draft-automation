import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CampaignForm, NEW_CAMPAIGN } from "../campaign-form";

export default async function NewCampaignPage() {
  await requireUser("campaign.manage");
  const supabase = await createClient();
  const [{ data: offers }, { data: inboxes }] = await Promise.all([
    supabase.from("offers").select("id, name").is("deleted_at", null).order("name"),
    supabase.from("inboxes").select("id, email").is("deleted_at", null).order("email"),
  ]);
  return (
    <>
      <PageHeader title="New campaign" />
      <CampaignForm defaults={NEW_CAMPAIGN} offers={offers ?? []} inboxes={inboxes ?? []} />
    </>
  );
}
