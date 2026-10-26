import { can, formatKolkata } from "@outreach/core";
import { Badge, EmptyState, PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AddInboxForm, InboxLimitsForm } from "./forms";

export default async function InboxesPage() {
  const user = await requireUser("inbox.view");
  const supabase = await createClient();
  // The refresh-token column is not selectable by any user role; list only the safe columns.
  const { data: inboxes } = await supabase
    .from("inboxes")
    .select("id, email, display_name, status, scopes, daily_draft_cap, daily_send_cap, min_seconds_between_sends, last_health_check")
    .is("deleted_at", null)
    .order("created_at");
  const manage = can(user.role, "inbox.manage");

  return (
    <>
      <PageHeader title="Inboxes" description="Sender mailboxes. Google connection and token storage arrive in Phase 10." />
      {manage && <div className="mb-6"><AddInboxForm /></div>}
      {!inboxes?.length ? (
        <EmptyState>No inboxes yet.</EmptyState>
      ) : (
        <ul className="space-y-4">
          {inboxes.map((i) => (
            <li key={i.id} data-testid="inbox-row" className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{i.email}</p>
                  <p className="text-xs text-zinc-500">
                    Last health check: {i.last_health_check ? formatKolkata(i.last_health_check) : "never"}
                  </p>
                </div>
                <Badge tone={i.status === "active" ? "green" : i.status === "error" ? "red" : "amber"}>{i.status}</Badge>
              </div>
              {manage ? (
                <InboxLimitsForm inbox={i} />
              ) : (
                <p className="text-sm text-zinc-600">
                  Draft cap {i.daily_draft_cap}/day · send cap {i.daily_send_cap}/day · {i.min_seconds_between_sends}s between sends
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
