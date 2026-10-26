import { EmptyState, PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function LeadsPage() {
  await requireUser("lead.view");
  const supabase = await createClient();
  const { data: leads } = await supabase
    .from("campaign_leads")
    .select("id, status, lead_score, campaigns(name), contacts(full_name, job_title, email, companies(name, domain))")
    .order("created_at", { ascending: false })
    .limit(100);
  return (
    <>
      <PageHeader title="Leads" description="Read-only list for now. Import arrives in Phase 3, scoring in Phase 5." />
      {!leads?.length ? (
        <EmptyState>No leads yet.</EmptyState>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-zinc-500">
            <tr><th className="py-2">Contact</th><th>Title</th><th>Company</th><th>Campaign</th><th>Status</th><th>Score</th></tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="py-2">
                  <div className="font-medium">{l.contacts?.full_name}</div>
                  <div className="text-xs text-zinc-500">{l.contacts?.email}</div>
                </td>
                <td>{l.contacts?.job_title}</td>
                <td>{l.contacts?.companies?.name}</td>
                <td>{l.campaigns?.name}</td>
                <td>{l.status}</td>
                <td>{l.lead_score ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
