import { CheckCircle2, Info, XCircle } from "lucide-react";
import { formatKolkata } from "@outreach/core";
import { isTestActive, type TestRow } from "@/lib/adapter-tests";

/**
 * One block describing the newest "Test connection" / "Create test draft" outcome.
 * Neutral (grey/blue) = nothing to report yet or "no key yet"; green = it worked; red = a real failure only.
 * `noKey` says the key is not added yet: a missing or failed test then stays neutral and asks for the key (a practice-mode pass still shows).
 */
export function TestResultLine({ test, testId, noKey = false }: { test: TestRow | undefined; testId: string; noKey?: boolean }) {
  const failed = test && !isTestActive(test) && (test.state === "failed" || !test.result || !test.result.ok);
  if (noKey && (!test || failed)) {
    return (
      <p className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900" data-testid={testId}>
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        No key yet, so there is nothing to test. Add your key first, then press Test connection.
      </p>
    );
  }
  if (!test) return <p className="text-xs text-muted-foreground" data-testid={testId}>Not tested yet.</p>;
  if (isTestActive(test)) {
    return (
      <p className="text-xs text-muted-foreground" data-testid={testId}>
        {test.waitingTooLong ? "Waiting for the worker. Is it running? (pnpm dev starts it.)" : "Testing…"}
      </p>
    );
  }
  if (test.state === "failed" || !test.result) {
    return (
      <p className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800" data-testid={testId}>
        <XCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Failed: {test.error ?? "the worker did not return a result"}
      </p>
    );
  }
  const r = test.result;
  const usage = r.units ? Object.entries(r.units).map(([k, v]) => `${v} ${k}`).join(", ") : "";
  const demo = r.apollo?.mode === "mock";
  return (
    <div className={`space-y-1 rounded-lg border px-3 py-2 text-xs ${r.ok ? (demo ? "border-sky-200 bg-sky-50 text-sky-900" : "border-emerald-200 bg-emerald-50 text-emerald-900") : "border-red-200 bg-red-50 text-red-800"}`} data-testid={testId}>
      <p className="flex items-start gap-2 font-medium">
        {r.ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden /> : <XCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
        <span>
          {r.ok ? "OK" : "Failed"}: {r.message}
        </span>
      </p>
      {r.ok && usage && <p>Usage recorded: {usage}{r.costUsd !== undefined ? ` · cost $${r.costUsd}` : ""}</p>}
      {r.labelNote && <p className="text-amber-800">Note: {r.labelNote}.</p>}
      {r.apollo && (
        <ul className="list-disc pl-5" data-testid="apollo-test-details">
          <li>Key: {r.apollo.health === false ? "not accepted" : "accepted"}{demo ? " (practice mode: nothing real was called)" : ""}</li>
          {r.apollo.search && <li>Finding people: {r.apollo.search.ok ? "allowed" : "not allowed"}{r.apollo.search.message ? `. ${r.apollo.search.message}` : ""}</li>}
          {r.apollo.reveal && <li>Getting email addresses: {r.apollo.reveal.ok ? "allowed" : "not allowed"}{r.apollo.reveal.message ? `. ${r.apollo.reveal.message}` : ""}</li>}
        </ul>
      )}
      <p className="opacity-75">{formatKolkata(r.finishedAt)}</p>
    </div>
  );
}
