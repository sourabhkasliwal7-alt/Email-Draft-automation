import { Info } from "lucide-react";
import { can, type Role } from "@outreach/core";
import { TestResultLine } from "@/components/test-result";
import { Badge } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { latestAdapterTests } from "@/lib/adapter-tests";
import { testConnection } from "./actions";

/** What the Apollo tab needs to know about the key, read from the environment (the key itself is never shown). */
export function apolloState() {
  const keySet = Boolean(process.env.APOLLO_API_KEY?.trim());
  const modeLive = process.env.ADAPTER_APOLLO?.trim().toLowerCase() === "live";
  return { keySet, modeLive, live: keySet && modeLive };
}

/** Setup > Apollo: is the key there, is it really used, and what can it do. */
export async function ApolloTab({ role }: { role: Role }) {
  const { keySet, modeLive, live } = apolloState();
  const manage = can(role, "settings.manage");
  const tests = manage ? await latestAdapterTests() : {};

  return (
    <div id="apollo" data-testid="section-apollo" className="space-y-5">
      {!live && (
        <div className="flex gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900" data-testid="apollo-how-to">
          <Info className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div className="space-y-2">
            <p className="font-medium">Practice mode: add your Apollo key to find real people</p>
            <p>Until then the tool works with practice people and uses no email credits, so you can try everything safely.</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>In Apollo, open Settings &gt; Integrations &gt; API and create a key.</li>
              <li>
                Put <code>APOLLO_API_KEY=…</code> and <code>ADAPTER_APOLLO=live</code> in the <code>.env</code> file.
              </li>
              <li>Restart the app, then press Test connection here.</li>
            </ol>
            {keySet && !modeLive && <p className="font-medium">The key is there, but Apollo is still switched to practice mode. Add ADAPTER_APOLLO=live.</p>}
          </div>
        </div>
      )}

      <Card data-testid="apollo-account">
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Apollo account</h2>
              <p className="text-sm text-muted-foreground" data-testid="apollo-key-status">
                Apollo key: <strong className="text-foreground">{keySet ? "set" : "not set"}</strong> · Status:{" "}
                <strong className="text-foreground" data-testid="apollo-mode">
                  {live ? "Live: real Apollo data" : "Practice mode: practice people, no credits used"}
                </strong>
              </p>
            </div>
            <Badge tone={live ? "green" : "neutral"}>{live ? "Live" : "Practice mode"}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">Apollo finds the people for a campaign. For the leads that pass the checks, it unlocks their email address: one email credit each, never twice.</p>

          {manage ? (
            <div className="space-y-3 border-t pt-4">
              <form action={testConnection}>
                <input type="hidden" name="provider" value="apollo" />
                <Button type="submit" variant="outline" data-testid="test-apollo">
                  Test connection
                </Button>
              </form>
              <TestResultLine test={tests.apollo} testId="test-result-apollo" noKey={!keySet} />
              <p className="text-xs text-muted-foreground">
                The test checks that the key is accepted, that finding people works, and whether your Apollo plan lets us unlock email addresses. It uses no email credits. If your plan has no API access, Apollo says so here: upgrade the plan, or use CSV files instead.
              </p>
            </div>
          ) : (
            <p className="border-t pt-4 text-xs text-muted-foreground">Only an admin can test the connection.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
