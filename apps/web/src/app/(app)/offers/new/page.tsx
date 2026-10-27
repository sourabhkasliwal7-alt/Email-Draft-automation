import { BackLink } from "@/components/bits";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { OfferForm } from "../forms";

export default async function NewOfferPage() {
  await requireUser("offer.manage");
  return (
    <>
      <BackLink href="/setup?tab=offers">Setup</BackLink>
      <PageHeader title="New offer" description="Say what you offer and what the emails may claim. You add case studies on the next screen." />
      <div className="py-6">
        <OfferForm />
      </div>
    </>
  );
}
