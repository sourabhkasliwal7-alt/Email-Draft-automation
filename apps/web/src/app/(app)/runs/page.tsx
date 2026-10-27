import { can, formatKolkata } from "@outreach/core";
import { Badge, EmptyState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/link-button";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cancelRunAction, resumeRunAction } from "./actions";
import { StartRunForm } from "./forms";
import { PAUSE_TEXT, STATUS_TONE } from "./labels";

export default async function RunsPage() {
  const user = await requireUser("run.view");
  const supabase = await createClient();
  const start = can(user.role, "workflow.start");
  const [{ data: runs }, { data: campaigns }] = await Promise.all([
    supabase.from("pipeline_batches").select("id, status, label, pause_reason, started_at, finished_at, totals, estimate, campaigns(name)").order("started_at", { ascending: false }).limit(30),
    supabase.from("campaigns").select("id, name, daily_cap, inboxes(email)").is("deleted_at", null).order("name"),
  ]);
  const estimate = Object.fromEntries(
    (campaigns ?? []).map((c) => [
      c.id,
      `Up to ${c.daily_cap} Gmail drafts today, searching for about ${Math.ceil(c.daily_cap / 0.75)} people (the search is free). Apollo credits are used only for approved leads, at most ${c.daily_cap}.${c.inboxes ? "" : " No mailbox is chosen on this campaign yet, so a real run will stop."}`,
    ]),
  );
  return (
    <>
      <PageHeader title="Runs" description="Each run searches, checks, researches, scores, reveals emails for the best leads and creates Gmail drafts. Nothing is sent." />
      {start && campaigns?.length ? <StartRunForm campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))} estimate={estimate} /> : null}
      {start && !campaigns?.length && <EmptyState>Create a campaign first.</EmptyState>}
      <h2 className="mb-3 mt-8 text-lg font-semibold">Recent runs</h2>
      {!runs?.length ? (
        <EmptyState>No runs yet.</EmptyState>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-zinc-500">
            <tr>
              <th className="py-2">Started (IST)</th>
              <th>Campaign</th>
              <th>Status</th>
              <th>Now / last step</th>
              <th>Gmail drafts</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const t = r.totals as { log?: { step: string; count: number | null }[]; summary?: { drafts: number }; target?: number };
              const last = t.log?.[t.log.length - 1];
              const dry = (r.estimate as { dryRun?: boolean } | null)?.dryRun;
              return (
                <tr key={r.id} className="border-t" data-testid="run-row">
                  <td className="py-2">{formatKolkata(r.started_at)}</td>
                  <td>
                    {r.campaigns?.name}
                    {dry ? " (dry run)" : ""}
                  </td>
                  <td>
                    <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</Badge>
                    {r.pause_reason && <div className="text-xs text-zinc-500">{PAUSE_TEXT[r.pause_reason] ?? r.pause_reason}</div>}
                  </td>
                  <td>{last ? `${last.step}${last.count != null ? ` (${last.count})` : ""}` : "starting"}</td>
                  <td>
                    {t.summary?.drafts ?? "-"}
                    {t.target != null ? ` of ${t.target}` : ""}
                  </td>
                  <td className="flex justify-end gap-2 py-1">
                    <LinkButton variant="outline" size="sm" href={`/runs/${r.id}`}>
                      Log
                    </LinkButton>
                    {start && r.status === "paused" && (
                      <form action={resumeRunAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <Button type="submit" size="sm">
                          Resume
                        </Button>
                      </form>
                    )}
                    {start && (r.status === "running" || r.status === "paused") && (
                      <form action={cancelRunAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <Button type="submit" variant="destructive" size="sm">
                          Cancel
                        </Button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
