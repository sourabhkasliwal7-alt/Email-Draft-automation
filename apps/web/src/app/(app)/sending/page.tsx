import { ComingSoon, PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";

export default async function Page() {
  await requireUser("send.view");
  return (
    <>
      <PageHeader title="Sending" />
      <ComingSoon phase={11}>Approved-only sending: reviewed batches, send log and retries. Only sender and admin roles can approve sending.</ComingSoon>
    </>
  );
}
