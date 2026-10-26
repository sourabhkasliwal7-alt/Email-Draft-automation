import { ComingSoon, PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";

export default async function Page() {
  await requireUser("review.view");
  return (
    <>
      <PageHeader title="Review" />
      <ComingSoon phase={10}>Review queue: evidence, score, draft, warnings; edit, regenerate, approve for Gmail or skip.</ComingSoon>
    </>
  );
}
