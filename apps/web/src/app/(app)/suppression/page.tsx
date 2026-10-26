import { can, formatKolkata } from "@outreach/core";
import { Badge, EmptyState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { removeSuppression } from "./actions";
import { AddSuppressionForm, UploadSuppressionForm } from "./forms";

export default async function SuppressionPage() {
  const user = await requireUser("suppression.view");
  const supabase = await createClient();
  const [{ data: rows }, { data: campaigns }] = await Promise.all([
    supabase
      .from("suppression")
      .select("id, email_lower, domain, scope, reason, source, created_at, campaigns(name)")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.from("campaigns").select("id, name").is("deleted_at", null).order("name"),
  ]);
  const canAdd = can(user.role, "suppression.add");
  const canRemove = can(user.role, "suppression.remove");

  return (
    <>
      <PageHeader
        title="Suppression"
        description="Do-not-contact list. Checked at import, before research spend, before drafting and immediately before every send."
      />
      {canAdd && (
        <div className="mb-8 grid gap-4 lg:grid-cols-2">
          <AddSuppressionForm campaigns={campaigns ?? []} />
          <UploadSuppressionForm campaigns={campaigns ?? []} />
        </div>
      )}
      {!rows?.length ? (
        <EmptyState>The suppression list is empty.</EmptyState>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-zinc-500">
            <tr>
              <th className="py-2">Entry</th>
              <th>Scope</th>
              <th>Reason</th>
              <th>Source</th>
              <th>Added (IST)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t" data-testid="suppression-row">
                <td className="py-2 font-medium">{r.email_lower ?? `@${r.domain}`}</td>
                <td>{r.scope === "campaign" ? <Badge tone="amber">{r.campaigns?.name ?? "campaign"}</Badge> : <Badge>global</Badge>}</td>
                <td>{r.reason}</td>
                <td>{r.source}</td>
                <td>{formatKolkata(r.created_at)}</td>
                <td className="text-right">
                  {canRemove && (
                    <form action={removeSuppression}>
                      <input type="hidden" name="id" value={r.id} />
                      <Button type="submit" variant="destructive" size="sm">
                        Remove
                      </Button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
