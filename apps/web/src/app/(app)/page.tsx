import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

async function count(table: "campaigns" | "campaign_leads" | "suppression" | "offers" | "email_drafts" | "email_sends") {
  const supabase = await createClient();
  const { count: n } = await supabase.from(table).select("id", { count: "exact", head: true });
  return n ?? 0;
}

export default async function DashboardPage() {
  const user = await requireUser("dashboard.view");
  const [campaigns, leads, drafts, sends, offers, suppression] = await Promise.all([
    count("campaigns"),
    count("campaign_leads"),
    count("email_drafts"),
    count("email_sends"),
    count("offers"),
    count("suppression"),
  ]);
  const cards = [
    ["Campaigns", campaigns],
    ["Leads", leads],
    ["Drafts", drafts],
    ["Sends", sends],
    ["Offers", offers],
    ["Suppressed", suppression],
  ] as const;
  return (
    <>
      <PageHeader title="Dashboard" description={`Signed in as ${user.email} (${user.role}). Full KPIs, funnel and cost reporting arrive in Phase 12.`} />
      <div className="grid max-w-3xl grid-cols-2 gap-4 sm:grid-cols-3">
        {cards.map(([label, n]) => (
          <div key={label} className="rounded-lg border p-4">
            <div className="text-2xl font-semibold" data-testid={`stat-${label.toLowerCase()}`}>{n}</div>
            <div className="text-sm text-zinc-500">{label}</div>
          </div>
        ))}
      </div>
    </>
  );
}
