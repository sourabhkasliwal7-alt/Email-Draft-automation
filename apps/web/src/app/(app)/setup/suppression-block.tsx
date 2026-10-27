import { can, formatKolkata, type Role } from "@outreach/core";
import { Badge, EmptyState } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { removeSuppression } from "../suppression/actions";
import { AddSuppressionForm, UploadSuppressionForm } from "../suppression/forms";

/** The do-not-contact list: add an email or domain, upload a file, see the list. Only an admin can remove an entry. */
export async function SuppressionBlock({ role }: { role: Role }) {
  const supabase = await createClient();
  const [{ data: rows }, { data: campaigns }] = await Promise.all([
    supabase.from("suppression").select("id, email_lower, domain, scope, reason, source, created_at, campaigns(name)").order("created_at", { ascending: false }).limit(500),
    supabase.from("campaigns").select("id, name").is("deleted_at", null).order("name"),
  ]);
  const canAdd = can(role, "suppression.add");
  const canRemove = can(role, "suppression.remove");
  return (
    <section id="suppression" data-testid="suppression-block" className="space-y-3 rounded-2xl border bg-card p-5 shadow-card">
      <div>
        <h2 className="text-lg font-semibold">Do-not-contact list</h2>
        <p className="text-sm text-muted-foreground">People and companies we must never write to. It is checked when leads are added, before any research is paid for, before every email is written and before every draft is saved.</p>
      </div>
      {canAdd && (
        <div className="grid gap-4 lg:grid-cols-2">
          <AddSuppressionForm campaigns={campaigns ?? []} />
          <UploadSuppressionForm campaigns={campaigns ?? []} />
        </div>
      )}
      {!rows?.length ? (
        <EmptyState>The list is empty.</EmptyState>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr><th className="py-2">Entry</th><th>Applies to</th><th>Reason</th><th>Source</th><th>Added (IST)</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t" data-testid="suppression-row">
                <td className="py-2 font-medium">{r.email_lower ?? `@${r.domain}`}</td>
                <td>{r.scope === "campaign" ? <Badge tone="amber">{r.campaigns?.name ?? "one campaign"}</Badge> : <Badge>all campaigns</Badge>}</td>
                <td>{r.reason}</td>
                <td>{r.source}</td>
                <td>{formatKolkata(r.created_at)}</td>
                <td className="text-right">
                  {canRemove && (
                    <form action={removeSuppression}>
                      <input type="hidden" name="id" value={r.id} />
                      <Button type="submit" variant="destructive" size="sm">Remove</Button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
