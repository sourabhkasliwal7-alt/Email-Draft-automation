import { AlertTriangle, CheckCircle2, Info, Mail, PlugZap, RefreshCw, Unplug } from "lucide-react";
import { GMAIL_MODIFY_SCOPE } from "@outreach/adapters";
import { can, formatKolkata, type Role } from "@outreach/core";
import { ConfirmButton } from "@/components/confirm";
import { LinkButton } from "@/components/link-button";
import { Badge } from "@/components/page-header";
import { TestResultLine } from "@/components/test-result";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { latestAdapterTests } from "@/lib/adapter-tests";
import { isDemoInbox } from "@/lib/demo-data";
import { GMAIL_MESSAGES, googleConfig, testingExpiry } from "@/lib/google";
import { gmailBanner } from "@/lib/setup-tabs";
import { createClient } from "@/lib/supabase/server";
import { createTestDraft, disconnectInbox } from "../inboxes/actions";
import { AddInboxForm, InboxLimitsForm } from "../inboxes/forms";

const TONE: Record<string, "green" | "amber" | "red" | "neutral"> = { active: "green", error: "red", needs_reconnect: "amber", paused: "amber", disconnected: "neutral" };
const LABEL: Record<string, string> = { active: "Connected", needs_reconnect: "Needs reconnect", disconnected: "Not connected", paused: "Paused", error: "Error" };

/** The facts the tab bar needs about Gmail (also used by the page header). */
export async function loadGmailFacts() {
  const supabase = await createClient();
  const { data } = await supabase.from("inboxes").select("id, email, status, scopes, connected_at").is("deleted_at", null);
  const rows = data ?? [];
  const withLabel = (i: { status: string; scopes: string[] }) => i.status !== "active" || i.scopes.includes(GMAIL_MODIFY_SCOPE);
  const real = rows.filter((i) => !isDemoInbox(i));
  const gmailReady = real.some((i) => i.status === "active" && withLabel(i)) && !real.some((i) => i.status === "needs_reconnect");
  return { gmailReady, count: rows.length };
}

/** Setup > Gmail: every Gmail account the drafts are created in. Each mailbox signs in to Google on its own. */
export async function GmailTab({ role, gmail, adding }: { role: Role; gmail?: string; adding: boolean }) {
  const supabase = await createClient();
  // The refresh-token column is not selectable by any user role; list only the safe columns.
  const { data: inboxes } = await supabase
    .from("inboxes")
    .select("id, email, display_name, status, scopes, daily_draft_cap, daily_send_cap, min_seconds_between_sends, last_health_check, connected_at, last_error")
    .is("deleted_at", null)
    .order("created_at");
  const list = inboxes ?? [];
  const manage = can(role, "inbox.manage");
  const cfg = googleConfig();
  const tests = manage ? await latestAdapterTests() : {};
  const message = gmail ? GMAIL_MESSAGES[gmail] : undefined;
  const testing = cfg.ok ? cfg.publishing === "testing" : true;
  const hasLabelPermission = (i: { status: string; scopes: string[] }) => i.status !== "active" || i.scopes.includes(GMAIL_MODIFY_SCOPE);
  const banner = gmailBanner(
    list.map((i) => ({ email: i.email, status: i.status, hasLabelPermission: hasLabelPermission(i), expiresAt: testing && i.status === "active" ? testingExpiry(i.connected_at) : null })),
  );

  return (
    <div id="mailboxes" data-testid="section-mailboxes" className="space-y-5">
      {banner && (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="gmail-banner">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
          <p className="font-medium">{banner}</p>
        </div>
      )}
      {message && (
        <p
          role="status"
          data-testid="gmail-message"
          className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${message.tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-800"}`}
        >
          {message.tone === "ok" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />}
          {message.text}
        </p>
      )}
      {manage && !cfg.ok && (
        <div className="flex items-start gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900" data-testid="google-not-configured">
          <Info className="mt-0.5 size-5 shrink-0" aria-hidden />
          <p>
            <span className="font-medium">Google is not set up yet, so a mailbox cannot sign in.</span> Missing in .env: {cfg.missing.join(", ")}. Open &quot;Technical details&quot; below for the steps.
          </p>
        </div>
      )}

      {manage && (adding || list.length === 0) && <AddInboxForm />}

      {!list.length ? (
        <Card className="flex flex-col items-center gap-3 border-dashed px-6 py-10 text-center" data-testid="empty-state">
          <span className="grid size-11 place-items-center rounded-full bg-brand-tint text-brand" aria-hidden>
            <Mail className="size-5" />
          </span>
          <p className="max-w-md text-sm text-muted-foreground">No mailbox yet. Add your Gmail address, then press Connect Gmail on its card. A second Gmail account works the same way.</p>
        </Card>
      ) : (
        <ul className="space-y-4">
          {list.map((i) => {
            const expiry = testing && i.status === "active" ? testingExpiry(i.connected_at) : null;
            const needs = i.status === "needs_reconnect";
            // connected before the label permission existed: it works, but drafts cannot get their label until the person reconnects
            const labelPermission = hasLabelPermission(i);
            const reconnectNow = needs || !labelPermission;
            return (
              <li key={i.id}>
                <Card data-testid="inbox-row" className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <p className="flex flex-wrap items-center gap-2 text-base font-semibold">
                        {i.email}
                        {isDemoInbox(i) && <Badge tone="neutral">Demo</Badge>}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Connected: {i.connected_at ? formatKolkata(i.connected_at) : "never"}
                        {expiry && (
                          <span data-testid="expiry">
                            {" "}
                            · Sign-in expires: {formatKolkata(expiry.toISOString())}
                          </span>
                        )}
                      </p>
                      {i.last_health_check && <p className="text-xs text-muted-foreground">Last health check: {formatKolkata(i.last_health_check)}</p>}
                      {!labelPermission && (
                        <p className="max-w-xl text-xs text-amber-800" data-testid="reconnect-needed-note">
                          Reconnect needed: this mailbox was connected before drafts could get the AI-Outreach label. Press Reconnect and allow the new permission.
                        </p>
                      )}
                      {needs && i.last_error && (
                        <p className="max-w-xl text-xs text-amber-800" data-testid="reconnect-reason">
                          {i.last_error}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <Badge tone={TONE[i.status] ?? "neutral"}>{LABEL[i.status] ?? i.status}</Badge>
                      {!labelPermission && (
                        <span data-testid="reconnect-needed">
                          <Badge tone="amber">Reconnect needed</Badge>
                        </span>
                      )}
                    </div>
                  </div>

                  {manage && (
                    <div className="mt-4 space-y-3 border-t pt-4">
                      <div className="flex flex-wrap items-center gap-2">
                        {/* a plain link: the route answers with a redirect to Google */}
                        <LinkButton
                          href={`/api/google/connect?inbox=${i.id}`}
                          plain
                          disabled={!cfg.ok}
                          variant={reconnectNow || i.status === "disconnected" ? "default" : "outline"}
                          icon={i.status === "disconnected" ? <PlugZap aria-hidden /> : <RefreshCw aria-hidden />}
                          data-testid="connect-gmail"
                        >
                          {i.status === "disconnected" ? "Connect Gmail" : "Reconnect"}
                        </LinkButton>
                        {i.status === "active" && (
                          <form action={createTestDraft}>
                            <input type="hidden" name="id" value={i.id} />
                            <Button type="submit" variant="outline" data-testid="test-draft">
                              Create test draft
                            </Button>
                          </form>
                        )}
                        {i.status !== "disconnected" && (
                          <form action={disconnectInbox}>
                            <input type="hidden" name="id" value={i.id} />
                            <ConfirmButton
                              variant="destructive"
                              icon={<Unplug aria-hidden />}
                              data-testid="disconnect-gmail"
                              confirm={{
                                title: `Disconnect ${i.email}?`,
                                confirmLabel: "Disconnect",
                                tone: "danger",
                                body: <p>Google is told to forget the sign-in and it is deleted here. Drafts already in Gmail stay. You can connect again at any time.</p>,
                              }}
                            >
                              Disconnect
                            </ConfirmButton>
                          </form>
                        )}
                      </div>
                      {i.status === "active" && <TestResultLine test={tests[`gmail:${i.id}`]} testId="test-draft-result" />}
                    </div>
                  )}

                  <div className="mt-4 rounded-xl bg-muted/50 p-4">
                    {manage ? <InboxLimitsForm inbox={i} /> : <p className="text-sm text-muted-foreground">Draft limit {i.daily_draft_cap} a day</p>}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {manage && (
        <details className="group rounded-xl border bg-card px-5 py-3 shadow-card" data-testid="technical-details">
          <summary className="cursor-pointer list-none text-sm font-medium text-foreground marker:hidden [&::-webkit-details-marker]:hidden">
            <span className="flex items-center justify-between">
              Technical details
              <span aria-hidden className="text-lg leading-none text-brand transition-transform group-open:rotate-45">
                +
              </span>
            </span>
          </summary>
          <div className="mt-3 space-y-3 text-sm text-muted-foreground">
            <div data-testid="google-redirect-uri">
              Register this exact value in Google Cloud under Authorized redirect URIs: <code>{cfg.redirectUri ?? "(set NEXT_PUBLIC_SITE_URL in .env first)"}</code>
            </div>
            {testing && (
              <div data-testid="testing-warning">
                <p className="font-medium text-foreground">Your Google app is in Testing mode: Gmail sign-ins stop working after 7 days.</p>
                <p className="mt-1">
                  Each mailbox then shows &quot;Needs reconnect&quot; and must be connected again. To stop that, open Google Cloud &gt; OAuth consent screen and set the publishing status to &quot;In production&quot;, then set GOOGLE_APP_PUBLISHING=production in .env.
                </p>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
