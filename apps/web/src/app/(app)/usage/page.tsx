import { ComingSoon, PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";

export default async function Page() {
  await requireUser("cost.view");
  return (
    <>
      <PageHeader title="Usage & Cost" />
      <ComingSoon phase={12}>Actual cost from recorded usage x the price table, against budget.</ComingSoon>
    </>
  );
}
