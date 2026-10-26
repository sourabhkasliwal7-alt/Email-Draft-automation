import { ComingSoon, PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";

export default async function Page() {
  await requireUser("followup.view");
  return (
    <>
      <PageHeader title="Follow-ups" />
      <ComingSoon phase={11}>Due dates and follow-up drafts.</ComingSoon>
    </>
  );
}
