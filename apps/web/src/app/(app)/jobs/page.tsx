import { ComingSoon, PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";

export default async function Page() {
  await requireUser("jobs.view");
  return (
    <>
      <PageHeader title="Jobs" />
      <ComingSoon phase={4}>Queue, steps, retries and dead letters.</ComingSoon>
    </>
  );
}
