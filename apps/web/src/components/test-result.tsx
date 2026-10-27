import { formatKolkata } from "@outreach/core";
import { isTestActive, type TestRow } from "@/lib/adapter-tests";

/** One line describing the newest "Test connection" / "Create test draft" outcome. */
export function TestResultLine({ test, testId }: { test: TestRow | undefined; testId: string }) {
  if (!test) return <p className="text-xs text-zinc-500" data-testid={testId}>Not tested yet.</p>;
  if (isTestActive(test)) {
    return (
      <p className="text-xs text-zinc-600" data-testid={testId}>
        {test.waitingTooLong ? "Waiting for the worker. Is it running? (pnpm dev starts it.)" : "Testing…"}
      </p>
    );
  }
  if (test.state === "failed" || !test.result) {
    return <p className="text-xs font-medium text-red-700" data-testid={testId}>Failed: {test.error ?? "the worker did not return a result"}</p>;
  }
  const r = test.result;
  const usage = r.units ? Object.entries(r.units).map(([k, v]) => `${v} ${k}`).join(", ") : "";
  return (
    <div className="space-y-0.5 text-xs" data-testid={testId}>
      <p className={r.ok ? "font-medium text-emerald-700" : "font-medium text-red-700"}>{r.ok ? "OK" : "Failed"}: {r.message}</p>
      {r.ok && usage && <p className="text-zinc-600">Usage recorded: {usage}{r.costUsd !== undefined ? ` · cost $${r.costUsd}` : ""}</p>}
      {r.labelNote && <p className="text-amber-700">Note: {r.labelNote}.</p>}
      <p className="text-zinc-500">{formatKolkata(r.finishedAt)}</p>
    </div>
  );
}
