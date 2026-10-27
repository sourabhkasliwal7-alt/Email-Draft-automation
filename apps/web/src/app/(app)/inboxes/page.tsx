import { can, formatKolkata } from "@outreach/core";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge, EmptyState, PageHeader } from "@/components/page-header";
import { TestResultLine } from "@/components/test-result";
import { Button } from "@/components/ui/button";
import { isTestActive, latestAdapterTests } from "@/lib/adapter-tests";
import { requireUser } from "@/lib/auth";
import { GMAIL_MESSAGES, googleConfig, testingExpiry } from "@/lib/google";
import { createClient } from "@/lib/supabase/server";
import { createTestDraft, disconnectInbox } from "./actions";
import { AddInboxForm, InboxLimitsForm } from "./forms";

const TONE: Record<string, "green" | "amber" | "red" | "neutral"> = { active: "green", error: "red", needs_reconnect: "red", paused: "amber", disconnected: "neutral" };
const LABEL: Record<string, string> = { active: "Connected", needs_reconnect: "Needs reconnect", disconnected: "Not connected", paused: "Paused", error: "Error" };

export default async function InboxesPage({ searchParams }: { searchParams: Promise<{ gmail?: string }> }) {
  const user = await requireUser("inbox.view");
  const { gmail } = await searchParams;
  const supabase = await createClient();
  // The refresh-token column is not selectable by any user role; list only the safe columns.
  const { data: inboxes } = await supabase
    .from("inboxes")
    .select("id, email, display_name, status, scopes, daily_draft_cap, daily_send_cap, min_seconds_between_sends, last_health_check, connected_at, last_error")
    .is("deleted_at", null)
    .order("created_at");
  const manage = can(user.role, "inbox.manage");
  const cfg = googleConfig();
  const tests = manage ? await latestAdapterTests() : {};
  const anyActive = Object.values(tests).some(isTestActive);
  const message = gmail ? GMAIL_MESSAGES[gmail] : undefined;
  const testing = cfg.ok ? cfg.publishing === "testing" : true;
  const connected = (inboxes ?? []).filter((i) => i.connected_at);

  return (
    <>
      <PageHeader title="Mailboxes" description="Gmail accounts the drafts are created in. Each mailbox signs in to Google separately. Only drafts are created: nothing is sent." />
      <AutoRefresh active={anyActive} />

      {message && (
        <p role="status" data-testid="gmail-message" className={`mb-4 rounded-md border px-3 py-2 text-sm ${message.tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900"}`}>
          {message.text}
        </p>
      )}

      {manage && !cfg.ok && (
        <div className="mb-4 space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="google-not-configured">
          <p className="font-medium">Google is not configured yet. Missing in .env: {cfg.missing.join(", ")}.</p>
        </div>
      )}
      {manage && (
        <div className="mb-4 rounded-md border p-3 text-xs text-zinc-600" data-testid="google-redirect-uri">
          Register this exact value in Google Cloud under Authorized redirect URIs:{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 text-zinc-900">{cfg.redirectUri ?? "(set NEXT_PUBLIC_SITE_URL in .env first)"}</code>
        </div>
      )}
      {manage && testing && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="testing-warning">
          <p className="font-medium">Google app in Testing mode: Gmail sign-ins stop working after 7 days.</p>
          <p className="mt-1 text-xs">
            Each mailbox then shows &quot;Needs reconnect&quot; and must be connected again. To stop that, open Google Cloud &gt; OAuth consent screen and set the publishing status to &quot;In production&quot;, then set GOOGLE_APP_PUBLISHING=production in .env.
            {connected.length > 0 && " Expiry per mailbox is shown below."}
          </p>
        </div>
      )}

      {manage && <div className="mb-6"><AddInboxForm /></div>}
      {!inboxes?.length ? (
        <EmptyState>No mailboxes yet. Add one above, then press Connect Gmail on it. You can add a second Gmail account the same way.</EmptyState>
      ) : (
        <ul className="space-y-4">
          {inboxes.map((i) => {
            const expiry = testing && i.status === "active" ? testingExpiry(i.connected_at) : null;
            const needs = i.status === "needs_reconnect";
            return (
              <li key={i.id} data-testid="inbox-row" className="space-y-3 rounded-lg border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-0.5">
                    <p className="font-medium">{i.email}</p>
                    <p className="text-xs text-zinc-500">
                      Connected: {i.connected_at ? formatKolkata(i.connected_at) : "never"} · Last health check: {i.last_health_check ? formatKolkata(i.last_health_check) : "never"}
                    </p>
                    {expiry && (
                      <p className="text-xs text-amber-700" data-testid="expiry">
                        Testing mode: this sign-in stops working about {formatKolkata(expiry.toISOString())}.
                      </p>
                    )}
                    {needs && i.last_error && <p className="max-w-xl text-xs text-red-700" data-testid="reconnect-reason">{i.last_error}</p>}
                  </div>
                  <Badge tone={TONE[i.status] ?? "neutral"}>{LABEL[i.status] ?? i.status}</Badge>
                </div>

                {manage && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* a plain link: the route answers with a redirect to Google */}
                      <a
                        href={cfg.ok ? `/api/google/connect?inbox=${i.id}` : undefined}
                        aria-disabled={!cfg.ok}
                        data-testid="connect-gmail"
                        className={`inline-flex h-8 items-center rounded-md px-3 text-sm font-medium ${cfg.ok ? "bg-zinc-900 text-white" : "pointer-events-none bg-zinc-200 text-zinc-500"}`}
                      >
                        {i.status === "disconnected" ? "Connect Gmail" : "Reconnect"}
                      </a>
                      {i.status !== "disconnected" && (
                        <form action={disconnectInbox}>
                          <input type="hidden" name="id" value={i.id} />
                          <Button type="submit" variant="outline" size="sm">Disconnect</Button>
                        </form>
                      )}
                      {i.status === "active" && (
                        <form action={createTestDraft}>
                          <input type="hidden" name="id" value={i.id} />
                          <Button type="submit" variant="outline" size="sm" data-testid="test-draft">Create test draft</Button>
                        </form>
                      )}
                    </div>
                    {i.status === "active" && <TestResultLine test={tests[`gmail:${i.id}`]} testId="test-draft-result" />}
                  </div>
                )}

                {manage ? (
                  <InboxLimitsForm inbox={i} />
                ) : (
                  <p className="text-sm text-zinc-600">
                    Draft cap {i.daily_draft_cap}/day · send cap {i.daily_send_cap}/day · {i.min_seconds_between_sends}s between sends
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
