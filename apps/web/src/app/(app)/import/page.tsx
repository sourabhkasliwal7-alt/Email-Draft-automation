import { ComingSoon, PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";

export default async function Page() {
  await requireUser("import.use");
  return (
    <>
      <PageHeader title="Import" />
      <ComingSoon phase={3}>Upload CSV/XLSX, map columns, validate, dedupe and dry-run.</ComingSoon>
    </>
  );
}
