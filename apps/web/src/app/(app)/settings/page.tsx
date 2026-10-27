import { formatKolkata, workflowConfigToForm } from "@outreach/core";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { AutoRefresh } from "@/components/auto-refresh";
import { TestResultLine } from "@/components/test-result";
import { isTestActive, latestAdapterTests } from "@/lib/adapter-tests";
import { requireUser } from "@/lib/auth";
import { loadSettings } from "@/lib/settings";
import { loadWorkflowSettings } from "@/lib/workflow-settings";
import { createClient } from "@/lib/supabase/server";
import { deleteSpendCap, testConnection } from "./actions";
import { PriceForm, SettingsForm, SpendCapForm, WorkflowSettingsForm } from "./forms";

export default async function SettingsPage() {
  await requireUser("settings.view");
  const supabase = await createClient();
  const workflow = await loadWorkflowSettings(supabase);
  const tests = await latestAdapterTests();
  const env = process.env;
  const has = (...names: string[]) => names.some((n) => Boolean(env[n]?.trim()));
  const mode = (n: string) => (env[n]?.trim().toLowerCase() === "live" ? "live" : "mock");
  const CONNECTIONS = [
    { id: "anthropic", name: "Claude (Anthropic)", keyVar: "ANTHROPIC_API_KEY", configured: has("ANTHROPIC_API_KEY"), adapter: "ADAPTER_LLM", mode: mode("ADAPTER_LLM"), units: "input_token, output_token" },
    { id: "serper", name: "Serper (web search)", keyVar: "SERPER_API_KEY", configured: has("SERPER_API_KEY"), adapter: "ADAPTER_SEARCH", mode: mode("ADAPTER_SEARCH"), units: "search" },
    { id: "verifier", name: "ZeroBounce (email check)", keyVar: "VERIFIER_API_KEY or ZEROBOUNCE_API_KEY", configured: has("VERIFIER_API_KEY", "ZEROBOUNCE_API_KEY"), adapter: "ADAPTER_VERIFIER", mode: mode("ADAPTER_VERIFIER"), units: "verification" },
  ] as const;
  const [settings, { data: prices }, { data: caps }, { data: campaigns }, { data: audit }] = await Promise.all([
    loadSettings(supabase),
    supabase.from("price_table").select("id, provider, unit, usd_per_unit, effective_from").order("effective_from", { ascending: false }).limit(100),
    supabase.from("spend_caps").select("id, scope, period, cap_usd, provider, campaigns(name)").order("created_at"),
    supabase.from("campaigns").select("id, name").is("deleted_at", null).order("name"),
    supabase.from("audit_log").select("id, actor, action, entity, created_at").order("created_at", { ascending: false }).limit(25),
  ]);

  return (
    <>
      <PageHeader title="Settings" description="Admin only. Every change here is written to the audit log." />
      <AutoRefresh active={Object.values(tests).some(isTestActive)} />
      <div className="space-y-8">
        <section className="space-y-3" data-testid="connections">
          <h2 className="text-lg font-semibold">Connections</h2>
          <p className="text-xs text-zinc-500">
            Keys live in .env, never here. &quot;Test connection&quot; makes one tiny real call (priced from the price table, checked against the spend caps, usage recorded). It works while an adapter is still on mock and never switches it to live: that is ADAPTER_* in .env.
          </p>
          <ul className="space-y-3">
            {CONNECTIONS.map((c) => (
              <li key={c.id} className="space-y-2 rounded-lg border p-4" data-testid={`connection-${c.id}`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium">{c.name}</p>
                    <p className="text-xs text-zinc-500">
                      {c.keyVar}: {c.configured ? "set" : "NOT set"} · {c.adapter}: {c.mode} · price rows needed for: {c.units}
                    </p>
                  </div>
                  <form action={testConnection}>
                    <input type="hidden" name="provider" value={c.id} />
                    <Button type="submit" variant="outline" size="sm" disabled={!c.configured} data-testid={`test-${c.id}`}>Test connection</Button>
                  </form>
                </div>
                <TestResultLine test={tests[c.id]} testId={`test-result-${c.id}`} />
              </li>
            ))}
          </ul>
        </section>

        <WorkflowSettingsForm values={workflowConfigToForm(workflow)} scheduleEnabled={workflow.schedule_enabled} dryRun={workflow.dry_run} allowRisky={workflow.allow_risky} />
        <SettingsForm settings={settings} />

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Price table</h2>
          <PriceForm />
          {!prices?.length ? (
            <EmptyState>No prices yet. Add one for every provider/unit before enabling live adapters.</EmptyState>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-zinc-500">
                <tr><th className="py-2">Provider</th><th>Unit</th><th>USD / unit</th><th>Effective from (IST)</th></tr>
              </thead>
              <tbody>
                {prices.map((p) => (
                  <tr key={p.id} className="border-t" data-testid="price-row">
                    <td className="py-2">{p.provider}</td>
                    <td>{p.unit}</td>
                    <td>{p.usd_per_unit}</td>
                    <td>{formatKolkata(p.effective_from)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Spend caps</h2>
          <SpendCapForm campaigns={campaigns ?? []} />
          {!caps?.length ? (
            <EmptyState>No spend caps. Add at least a global daily cap.</EmptyState>
          ) : (
            <ul className="space-y-2 text-sm">
              {caps.map((c) => (
                <li key={c.id} className="flex items-center justify-between rounded-md border p-3" data-testid="cap-row">
                  <span>
                    {c.scope === "provider" ? `provider ${c.provider}` : c.scope === "campaign" ? `campaign ${c.campaigns?.name ?? ""}` : "global"} · {c.period} · ${c.cap_usd}
                  </span>
                  <form action={deleteSpendCap}>
                    <input type="hidden" name="id" value={c.id} />
                    <Button type="submit" variant="destructive" size="sm">Delete</Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Recent audit log</h2>
          {!audit?.length ? (
            <EmptyState>No entries yet.</EmptyState>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-zinc-500">
                <tr><th className="py-2">When (IST)</th><th>Action</th><th>Entity</th><th>Actor</th></tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id} className="border-t" data-testid="audit-row">
                    <td className="py-1">{formatKolkata(a.created_at)}</td>
                    <td>{a.action}</td>
                    <td>{a.entity}</td>
                    <td className="max-w-48 truncate">{a.actor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}
