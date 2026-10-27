"use client";

import { FlaskConical, Play } from "lucide-react";
import { useState } from "react";
import { ConfirmButton } from "@/components/confirm";
import { Checkbox, Field, FormMessage, SelectInput, useActionForm } from "@/components/form";
import { HelpTip } from "@/components/help-tip";
import { describeEstimate, type RunEstimate } from "@/lib/run-estimate";
import { startRunAction } from "./actions";

/**
 * The one "Start run" form (on Home). The button always says which kind of run it will be, and the confirmation says it again.
 * `forceTest` is the Setup > Advanced switch "always run as a test run": the box is ticked and cannot be cleared.
 */
export function StartRunForm({ campaigns, estimates, forceTest = false }: { campaigns: { id: string; name: string }[]; estimates: Record<string, RunEstimate>; forceTest?: boolean }) {
  const { state, onSubmit, pending } = useActionForm(startRunAction);
  const [test, setTest] = useState(forceTest);
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id ?? "");
  const err = state.fieldErrors ?? {};
  const est = estimates[campaignId];
  const name = campaigns.find((c) => c.id === campaignId)?.name ?? "";
  return (
    <form
      noValidate
      className="space-y-5"
      data-testid="start-run-form"
      onSubmit={onSubmit}
      onChange={(e) => {
        // keeps the button text and the estimate in step with the campaign and the Test run box
        const t = e.target as unknown as HTMLInputElement | HTMLSelectElement;
        if (t.name === "dryRun") setTest(forceTest || (t as HTMLInputElement).checked);
        if (t.name === "campaignId") setCampaignId(t.value);
      }}
    >
      {campaigns.length > 1 ? (
        <div className="max-w-md">
          <Field label="Campaign" name="campaignId" error={err.campaignId} help="A campaign is a group of leads, the offer you write about and the Gmail mailbox the drafts go in. Pick the one to run now.">
            <SelectInput name="campaignId" defaultValue={campaignId} options={campaigns.map((c) => ({ value: c.id, label: c.name }))} />
          </Field>
        </div>
      ) : (
        <>
          <input type="hidden" name="campaignId" value={campaigns[0]?.id ?? ""} />
          <p className="text-sm text-muted-foreground">
            Campaign: <strong className="text-foreground">{campaigns[0]?.name}</strong>
          </p>
        </>
      )}

      <div className="space-y-2 rounded-xl border bg-brand-soft p-4 text-sm" data-testid="run-estimate" aria-live="polite">
        <p className="font-medium text-foreground">What will happen</p>
        <p className="text-muted-foreground">
          {test
            ? "The tool looks at your leads, checks them and scores them, but writes no drafts and spends no email credits. A good first look."
            : "The tool finds or takes your leads, checks them, reads each company's website, writes a short personal email for the ones that fit and saves it as a Gmail draft. Nothing is sent."}
        </p>
        <p className="text-foreground" data-testid="estimate-line">
          {describeEstimate(est, test)}
        </p>
        {!test && est && !est.hasMailbox && <p className="font-medium text-amber-800">No Gmail mailbox is chosen on this campaign yet, so a real run will stop. Pick one in Setup &gt; Campaign.</p>}
      </div>

      <div>
        <Checkbox
          name="dryRun"
          label="Test run"
          description="Practice run: checks and scores your leads but writes no drafts and uses no email credits."
          defaultChecked={forceTest}
          disabled={forceTest}
          help="Use a test run to see how many leads would pass before anything is written. It is free: no drafts, no email credits. Untick it for the real run."
        />
        {forceTest && <input type="hidden" name="dryRun" value="on" />}
      </div>

      <FormMessage state={state} />
      <div className="flex flex-wrap items-center gap-3">
        <ConfirmButton
          size="lg"
          icon={test ? <FlaskConical aria-hidden /> : <Play aria-hidden />}
          pending={pending}
          data-testid="start-run-button"
          confirm={() => ({
            title: test ? "Start a test run?" : "Start the run?",
            confirmLabel: test ? "Start test run (no drafts)" : "Start run",
            body: (
              <>
                <p>
                  {test ? <strong>Test run.</strong> : <strong>Real run.</strong>} Campaign: {name}.{" "}
                  {test ? "It checks and scores your leads. It makes no Gmail drafts and uses no email credits." : "It will create Gmail drafts for the leads that pass the checks. Nothing is ever sent."}
                </p>
                {est && <p>{describeEstimate(est, test)}</p>}
              </>
            ),
          })}
        >
          {test ? "Start test run (no drafts)" : "Start run"}
        </ConfirmButton>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          Which kind of run?
          <HelpTip label="which kind of run">
            &quot;Start run&quot; makes real Gmail drafts. &quot;Start test run&quot; only practises. You see a clear Test run or Real run label on every run.
          </HelpTip>
        </span>
      </div>
    </form>
  );
}
