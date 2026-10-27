import { can, type Role } from "@outreach/core";
import { Section } from "@/components/bits";
import { TestResultLine } from "@/components/test-result";
import { Button } from "@/components/ui/button";
import { latestAdapterTests } from "@/lib/adapter-tests";
import { testConnection } from "./actions";

/** Setup > Apollo account: is the key there, is it really used, and what can it do. The key itself is never shown. */
export async function ApolloSection({ role }: { role: Role }) {
  const keySet = Boolean(process.env.APOLLO_API_KEY?.trim());
  const modeLive = process.env.ADAPTER_APOLLO?.trim().toLowerCase() === "live";
  const live = keySet && modeLive;
  const manage = can(role, "settings.manage");
  const tests = manage ? await latestAdapterTests() : {};

  return (
    <Section id="apollo" title="Apollo account" description="Apollo finds people for you and, for the leads that pass the checks, unlocks their email address (one credit each, never twice).">
      <div className="space-y-2 rounded-lg border p-4" data-testid="apollo-account">
        <p className="text-sm" data-testid="apollo-key-status">
          Apollo key: <strong>{keySet ? "set" : "not set"}</strong> · Status:{" "}
          <strong data-testid="apollo-mode">{live ? "Live: real Apollo data" : "Demo: practice people, no credits used"}</strong>
        </p>
        {!live && (
          <p className="text-xs text-zinc-600" data-testid="apollo-how-to">
            To use your real Apollo account: put <code>APOLLO_API_KEY=…</code> and <code>ADAPTER_APOLLO=live</code> in the <code>.env</code> file, then restart the app. {keySet && !modeLive ? "The key is there, but Apollo is still switched to demo." : ""}
          </p>
        )}
        {manage ? (
          <>
            <form action={testConnection} className="pt-1">
              <input type="hidden" name="provider" value="apollo" />
              <Button type="submit" variant="outline" size="sm" data-testid="test-apollo">Test connection</Button>
            </form>
            <TestResultLine test={tests.apollo} testId="test-result-apollo" />
            <p className="text-xs text-zinc-500">
              The test checks that the key is accepted, that finding people works, and whether your Apollo plan lets us unlock email addresses. It does not use any email credits. If your plan has no API access, Apollo says so here: upgrade the plan, or use CSV files instead.
            </p>
          </>
        ) : (
          <p className="text-xs text-zinc-500">Only an admin can test the connection.</p>
        )}
      </div>
    </Section>
  );
}
