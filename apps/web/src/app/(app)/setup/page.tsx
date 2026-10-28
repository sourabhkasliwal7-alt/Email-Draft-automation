import { Plus } from "lucide-react";
import { can } from "@outreach/core";
import { AutoRefresh } from "@/components/auto-refresh";
import { LinkButton } from "@/components/link-button";
import { PageHeader } from "@/components/page-header";
import { isTestActive, latestAdapterTests } from "@/lib/adapter-tests";
import { requireUser } from "@/lib/auth";
import { SETUP_INSTRUCTIONS, parseSetupTab, setupTabMarks } from "@/lib/setup-tabs";
import { createClient } from "@/lib/supabase/server";
import { loadWorkflowSettings } from "@/lib/workflow-settings";
import { AdvancedTab } from "./advanced";
import { ApolloTab, apolloState } from "./apollo";
import { CampaignsTab, OffersTab, loadCampaignOfferFacts } from "./campaigns-offers";
import { FooterForm, ScheduleForm } from "./forms";
import { GmailTab, loadGmailFacts } from "./mailboxes";
import { EmailStyleForm } from "./style-form";
import { styleToForm } from "./schemas";
import { SetupTabs } from "./tabs";

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ tab?: string; gmail?: string; add?: string }> }) {
  const user = await requireUser("setup.view");
  const { tab: tabParam, gmail, add } = await searchParams;
  const tab = parseSetupTab(tabParam);
  const supabase = await createClient();
  const workflow = await loadWorkflowSettings(supabase);
  const admin = can(user.role, "settings.manage");
  const tests = admin ? await latestAdapterTests() : {};
  const [gmailFacts, counts] = await Promise.all([loadGmailFacts(), loadCampaignOfferFacts()]);

  const marks = setupTabMarks({
    gmailReady: gmailFacts.gmailReady,
    apolloLive: apolloState().live,
    campaigns: counts.campaigns,
    offers: counts.offers,
    footerSet: Boolean(workflow.postal_address.trim() && workflow.optout_line.trim()),
    scheduleOn: workflow.schedule_enabled,
  });

  // the one main button of the page, on the right of the sticky header
  const actions =
    tab === "gmail" && can(user.role, "inbox.manage") ? (
      <LinkButton href="/setup?tab=gmail&add=1" icon={<Plus aria-hidden />} data-testid="add-mailbox">
        Add mailbox
      </LinkButton>
    ) : tab === "campaigns" && can(user.role, "campaign.manage") ? (
      <LinkButton href="/campaigns/new" icon={<Plus aria-hidden />} data-testid="new-campaign">
        New campaign
      </LinkButton>
    ) : tab === "offers" && can(user.role, "offer.manage") ? (
      <LinkButton href="/offers/new" icon={<Plus aria-hidden />} data-testid="new-offer">
        New offer
      </LinkButton>
    ) : undefined;

  return (
    <>
      <PageHeader title="Setup" description={SETUP_INSTRUCTIONS[tab]} actions={actions} />
      <AutoRefresh active={Object.values(tests).some(isTestActive)} />
      <div className="space-y-6">
        <SetupTabs active={tab} marks={marks} />

        {tab === "gmail" && <GmailTab role={user.role} gmail={gmail} adding={add === "1"} senderCompany={workflow.sender_company} />}
        {tab === "apollo" && <ApolloTab role={user.role} />}
        {tab === "campaigns" && <CampaignsTab role={user.role} />}
        {tab === "offers" && <OffersTab role={user.role} />}
        {tab === "footer" && (
          <div id="footer" data-testid="section-footer">
            {admin ? (
              <FooterForm values={{ postal_address: workflow.postal_address, optout_line: workflow.optout_line, white_label_line: workflow.white_label_line }} />
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="footer-readonly">
                {workflow.postal_address.trim() ? "The footer is set." : "The footer is not set yet."} An admin can change it.
              </p>
            )}
          </div>
        )}
        {tab === "style" && (
          <div id="style" data-testid="section-style">
            <EmailStyleForm values={styleToForm(workflow)} canEdit={admin} />
          </div>
        )}
        {tab === "schedule" && (
          <div id="schedule" data-testid="section-schedule">
            {admin ? (
              <ScheduleForm values={{ schedule_enabled: workflow.schedule_enabled, run_time_ist: workflow.run_time_ist }} />
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="schedule-readonly">
                Automatic runs are {workflow.schedule_enabled ? `on, every weekday at ${workflow.run_time_ist} (India time)` : "off"}. An admin can change this.
              </p>
            )}
          </div>
        )}
        {tab === "advanced" && <AdvancedTab role={user.role} workflow={workflow} />}
      </div>
    </>
  );
}
