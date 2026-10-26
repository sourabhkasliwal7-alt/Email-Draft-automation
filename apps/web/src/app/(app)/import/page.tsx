import Link from "next/link";
import { formatKolkata } from "@outreach/core";
import { Badge, EmptyState, PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { UploadForm } from "./forms";

type Totals = { imported?: number; updated?: number; duplicate?: number; invalid?: number; suppressed?: number; skipped?: number; failed?: number; total?: number };

export default async function ImportPage() {
  await requireUser("import.use");
  const supabase = await createClient();
  const [{ data: campaigns }, { data: batches }] = await Promise.all([
    supabase.from("campaigns").select("id, name").is("deleted_at", null).order("name"),
    supabase
      .from("import_batches")
      .select("id, file_name, status, mode, dry_run, totals, created_at, campaigns(name)")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  return (
    <>
      <PageHeader title="Import" description="Upload, map, check and import leads. Suppression and do-not-contact are checked on every row." />
      <div className="mb-8">
        <UploadForm campaigns={campaigns ?? []} />
      </div>
      {!batches?.length ? (
        <EmptyState>No imports yet.</EmptyState>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-zinc-500">
            <tr><th className="py-2">File</th><th>Campaign</th><th>Status</th><th>Result</th><th>Started (IST)</th></tr>
          </thead>
          <tbody>
            {batches.map((b) => {
              const t = (b.totals ?? {}) as Totals;
              return (
                <tr key={b.id} className="border-t" data-testid="import-row">
                  <td className="py-2">
                    <Link href={`/import/${b.id}`} className="font-medium underline-offset-2 hover:underline">{b.file_name}</Link>
                  </td>
                  <td>{b.campaigns?.name}</td>
                  <td>
                    <Badge tone={b.status === "completed" ? "green" : b.status === "failed" ? "red" : b.status === "cancelled" ? "neutral" : "amber"}>
                      {b.status === "completed" && b.dry_run ? "dry run done" : b.status}
                    </Badge>
                  </td>
                  <td className="text-zinc-600">
                    {b.status === "completed" ? `${t.imported ?? 0} imported · ${t.duplicate ?? 0} duplicate · ${t.invalid ?? 0} invalid · ${t.suppressed ?? 0} suppressed` : ""}
                  </td>
                  <td>{formatKolkata(b.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
