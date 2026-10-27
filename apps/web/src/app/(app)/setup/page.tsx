import { can } from "@outreach/core";
import { AutoRefresh } from "@/components/auto-refresh";
import { Section } from "@/components/bits";
import { PageHeader } from "@/components/page-header";
import { isTestActive, latestAdapterTests } from "@/lib/adapter-tests";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadWorkflowSettings } from "@/lib/workflow-settings";
import { AdvancedSection } from "./advanced";
import { ApolloSection } from "./apollo";
import { CampaignSection, OfferSection } from "./campaigns-offers";
import { FooterForm, ScheduleForm } from "./forms";
import { MailboxesSection } from "./mailboxes";

const CONTENTS = [
  ["mailboxes", "Gmail mailboxes"],
  ["apollo", "Apollo account"],
  ["campaign", "Campaign"],
  ["offer", "Offer and case study"],
  ["footer", "Email footer"],
  ["schedule", "Schedule"],
  ["advanced", "Advanced"],
] as const;

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ gmail?: string }> }) {
  const user = await requireUser("setup.view");
  const { gmail } = await searchParams;
  const supabase = await createClient();
  const workflow = await loadWorkflowSettings(supabase);
  const admin = can(user.role, "settings.manage");
  const tests = admin ? await latestAdapterTests() : {};

  return (
    <>
      <PageHeader title="Setup" description="Everything you set once, in one place. Work down the list: Gmail, Apollo (optional), campaign, offer, footer." />
      <AutoRefresh active={Object.values(tests).some(isTestActive)} />
      <nav aria-label="On this page" className="mb-6 flex flex-wrap gap-2 text-sm" data-testid="setup-contents">
        {CONTENTS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="rounded-full border px-3 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            {label}
          </a>
        ))}
      </nav>

      <div className="space-y-10">
        <MailboxesSection role={user.role} gmail={gmail} />
        <ApolloSection role={user.role} />
        <CampaignSection role={user.role} />
        <OfferSection role={user.role} />

        <Section id="footer" title="Email footer" description="Added to the bottom of every email: where you are and how to opt out.">
          {admin ? (
            <FooterForm values={{ postal_address: workflow.postal_address, optout_line: workflow.optout_line, white_label_line: workflow.white_label_line }} />
          ) : (
            <p className="text-sm text-zinc-600" data-testid="footer-readonly">{workflow.postal_address.trim() ? "The footer is set." : "The footer is not set yet."} An admin can change it.</p>
          )}
        </Section>

        <Section id="schedule" title="Schedule" description="Let a run start by itself, or press Start run on Home whenever you want.">
          {admin ? (
            <ScheduleForm values={{ schedule_enabled: workflow.schedule_enabled, run_time_ist: workflow.run_time_ist }} />
          ) : (
            <p className="text-sm text-zinc-600" data-testid="schedule-readonly">
              Automatic runs are {workflow.schedule_enabled ? `on, every weekday at ${workflow.run_time_ist} (India time)` : "off"}. An admin can change this.
            </p>
          )}
        </Section>

        <AdvancedSection role={user.role} workflow={workflow} />
      </div>
    </>
  );
}
