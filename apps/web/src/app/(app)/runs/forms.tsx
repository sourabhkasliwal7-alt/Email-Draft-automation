"use client";

import { useState } from "react";
import { Checkbox, Field, FormMessage, SelectInput, SubmitButton, useActionForm } from "@/components/form";
import { startRunAction } from "./actions";

/**
 * The one "Start run" form (on Home). The button always says which kind of run it will be, and the confirmation says it again.
 * `forceTest` is the Setup > Advanced switch "always run as a test run": the box is ticked and cannot be cleared.
 */
export function StartRunForm({ campaigns, estimate, forceTest = false }: { campaigns: { id: string; name: string }[]; estimate: Record<string, string>; forceTest?: boolean }) {
  const { state, onSubmit, pending } = useActionForm(startRunAction);
  const [test, setTest] = useState(forceTest);
  const err = state.fieldErrors ?? {};
  return (
    <form
      noValidate
      className="max-w-xl space-y-3"
      data-testid="start-run-form"
      onSubmit={(e) => {
        const data = new FormData(e.currentTarget);
        const isTest = forceTest || data.has("dryRun");
        const line = estimate[String(data.get("campaignId") ?? "")] ?? "";
        const ok = window.confirm(
          `${isTest ? "TEST RUN: it looks for people, checks and scores them, but makes no Gmail drafts and uses no Apollo credits." : "REAL RUN: it will create Gmail drafts (nothing is ever sent)."}\n\n${line}\n\nStart now?`,
        );
        if (!ok) e.preventDefault();
        else onSubmit(e);
      }}
    >
      {campaigns.length > 1 ? (
        <Field label="Campaign" name="campaignId" error={err.campaignId}>
          <SelectInput name="campaignId" defaultValue={campaigns[0]?.id ?? ""} options={campaigns.map((c) => ({ value: c.id, label: c.name }))} />
        </Field>
      ) : (
        <input type="hidden" name="campaignId" value={campaigns[0]?.id ?? ""} />
      )}
      <div onChange={(e) => setTest(forceTest || (e.target as HTMLInputElement).checked)}>
        <Checkbox name="dryRun" label="Test run (no drafts, no credits)" defaultChecked={forceTest} disabled={forceTest} />
        {forceTest && <input type="hidden" name="dryRun" value="on" />}
      </div>
      <FormMessage state={state} />
      <SubmitButton pending={pending}>{test ? "Start test run (no drafts)" : "Start run"}</SubmitButton>
    </form>
  );
}
