import { BackLink } from "@/components/bits";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { OfferForm } from "../forms";

export default async function NewOfferPage() {
  await requireUser("offer.manage");
  return (
    <>
      <BackLink href="/setup#offer">Setup</BackLink>
      <PageHeader title="New offer" />
      <OfferForm />
    </>
  );
}
