import { LLM_KEY_VAR, LlmProviderError, modelFor, resolveLlmProvider, type LlmProvider } from "@outreach/adapters";
import { can, formatKolkata, parseWorkflowConfig, type Role, type WorkflowConfig } from "@outreach/core";
import { EmptyState } from "@/components/page-header";
import { TestResultLine } from "@/components/test-result";
import { Button } from "@/components/ui/button";
import { latestAdapterTests } from "@/lib/adapter-tests";
import { createClient } from "@/lib/supabase/server";
import { deleteSpendCap, testConnection } from "./actions";
import { CreditsForm, ModelsForm, PriceForm, RunRulesForm, SpendCapForm, WritingRulesForm } from "./forms";
import { writingRulesToForm } from "./schemas";
import { SuppressionBlock } from "./suppression-block";

/**
 * Setup > Advanced (collapsed). The technical settings live here: models, credit limits, the price table, spend caps,
 * connection tests, the suppression list and the audit log. Internal words are allowed here and only here.
 */
export async function AdvancedSection({ role, workflow: wf }: { role: Role; workflow: WorkflowConfig }) {
  const admin = can(role, "settings.manage");
  const workflow = parseWorkflowConfig(wf);
  const supabase = await createClient();
  const tests = admin ? await latestAdapterTests() : {};

  if (!admin) {
    return (
      <details id="advanced" data-testid="section-advanced" className="scroll-mt-6 rounded-lg border p-4">
        <summary className="cursor-pointer text-lg font-semibold">Advanced</summary>
        <div className="mt-4 space-y-6">
          <p className="text-sm text-zinc-500">The technical settings are for an admin. You can add people to the do-not-contact list here.</p>
          <SuppressionBlock role={role} />
        </div>
      </details>
    );
  }

  const env = process.env;
  const has = (...names: string[]) => names.some((n) => Boolean(env[n]?.trim()));
  const mode = (n: string) => (env[n]?.trim().toLowerCase() === "live" ? "live" : "mock");
  // which way Claude is reached: LLM_PROVIDER=anthropic|openrouter (default anthropic), and the models the run will ask for
  let llmProvider: LlmProvider = "anthropic";
  let llmProblem: string | null = null;
  try {
    llmProvider = resolveLlmProvider(env);
  } catch (e) {
    if (e instanceof LlmProviderError) llmProblem = e.message;
    else throw e;
  }
  const llmModels = [
    { what: "Quick check and email check", setting: workflow.model_screen },
    { what: "Facts from pages", setting: workflow.model_extract },
    { what: "Writing the email", setting: workflow.model_write },
  ].map((m) => ({ ...m, sent: modelFor(llmProvider, m.setting) }));
  const CONNECTIONS = [
    {
      id: "anthropic",
      name: llmProvider === "openrouter" ? "Claude via OpenRouter" : "Claude (Anthropic API)",
      keyVar: LLM_KEY_VAR[llmProvider],
      configured: has(LLM_KEY_VAR[llmProvider]),
      adapter: "ADAPTER_LLM",
      mode: mode("ADAPTER_LLM"),
      units: `${llmProvider} / input_token, output_token`,
    },
    { id: "serper", name: "Serper (web search)", keyVar: "SERPER_API_KEY", configured: has("SERPER_API_KEY"), adapter: "ADAPTER_SEARCH", mode: mode("ADAPTER_SEARCH"), units: "serper / search" },
    { id: "verifier", name: "ZeroBounce (email check)", keyVar: "VERIFIER_API_KEY or ZEROBOUNCE_API_KEY", configured: has("VERIFIER_API_KEY", "ZEROBOUNCE_API_KEY"), adapter: "ADAPTER_VERIFIER", mode: mode("ADAPTER_VERIFIER"), units: "verifier / verification" },
  ] as const;
  const [{ data: prices }, { data: caps }, { data: campaigns }, { data: audit }] = await Promise.all([
    supabase.from("price_table").select("id, provider, unit, usd_per_unit, effective_from").order("effective_from", { ascending: false }).limit(100),
    supabase.from("spend_caps").select("id, scope, period, cap_usd, provider, campaigns(name)").order("created_at"),
    supabase.from("campaigns").select("id, name").is("deleted_at", null).order("name"),
    supabase.from("audit_log").select("id, actor, action, entity, created_at").order("created_at", { ascending: false }).limit(25),
  ]);

  return (
    <details id="advanced" data-testid="section-advanced" className="scroll-mt-6 rounded-lg border p-4">
      <summary className="cursor-pointer text-lg font-semibold">Advanced</summary>
      <div className="mt-4 space-y-8">
        <p className="text-sm text-zinc-600">Technical settings. The defaults work; change them only if you know why. Every change is written to the audit log.</p>
        <RunRulesForm values={{ approve_threshold: workflow.approve_threshold, same_company_cooldown_days: workflow.same_company_cooldown_days, run_limit_minutes: workflow.run_limit_minutes, dry_run: workflow.dry_run, allow_risky: workflow.allow_risky, skip_verification: workflow.skip_verification }} />
        <CreditsForm values={{ daily_reveal_cap: workflow.daily_reveal_cap, monthly_credit_cap: workflow.monthly_credit_cap }} />
        <ModelsForm values={{ model_screen: workflow.model_screen, model_extract: workflow.model_extract, model_write: workflow.model_write }} />
        <WritingRulesForm values={writingRulesToForm(workflow)} />

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
                      {c.keyVar}: {c.configured ? "set" : "NOT set"} · {c.adapter}: {c.mode} · price rows needed (provider / unit): {c.units}
                    </p>
                    {c.id === "anthropic" && (
                      <div className="mt-2 space-y-1 text-xs text-zinc-600" data-testid="llm-details">
                        {llmProblem ? (
                          <p className="font-medium text-red-700">{llmProblem}</p>
                        ) : (
                          <>
                            <p>
                              Provider in use: <strong data-testid="llm-provider">{llmProvider}</strong> (LLM_PROVIDER in .env: <code>anthropic</code> or <code>openrouter</code>; change it and restart to switch).
                            </p>
                            <ul className="list-disc pl-4">
                              {llmModels.map((m) => (
                                <li key={m.what} data-testid="llm-model">
                                  {m.what}: <code>{m.setting}</code>
                                  {m.sent !== m.setting && (
                                    <>
                                      {" "}
                                      sent as <code>{m.sent}</code>
                                    </>
                                  )}
                                </li>
                              ))}
                            </ul>
                            <p data-testid="llm-price-hint">
                              Price rows: provider <code>{llmProvider}</code>, units <code>input_token</code> and <code>output_token</code> (USD per token). The two models cost different amounts, so name the model in the unit, for example{" "}
                              {[...new Set(llmModels.map((m) => m.sent))].map((model, i) => (
                                <span key={model}>
                                  {i > 0 && ", "}
                                  <code>input_token@{model}</code> / <code>output_token@{model}</code>
                                </span>
                              ))}
                              . A plain <code>input_token</code> row is used for any model without its own. OpenRouter lists each model&apos;s price at openrouter.ai/models (per-million prices divided by 1,000,000).
                            </p>
                          </>
                        )}
                      </div>
                    )}
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

        <SuppressionBlock role={role} />

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
    </details>
  );
}
