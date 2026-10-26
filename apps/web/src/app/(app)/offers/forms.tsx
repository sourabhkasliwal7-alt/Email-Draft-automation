"use client";

import { Field, FormMessage, SubmitButton, TextArea, TextInput, useActionForm } from "@/components/form";
import { saveCaseStudy, saveOffer } from "./actions";

export function OfferForm({
  offer,
}: {
  offer?: { id: string; name: string; description: string | null; allowed_claims: string[]; cta_options: string[] };
}) {
  const { state, onSubmit: action, pending } = useActionForm(saveOffer);
  const err = state.fieldErrors ?? {};
  return (
    <form onSubmit={action} className="max-w-xl space-y-4" noValidate>
      {offer && <input type="hidden" name="id" value={offer.id} />}
      <Field label="Offer name" name="name" error={err.name}>
        <TextInput name="name" defaultValue={offer?.name} />
      </Field>
      <Field label="Description" name="description" error={err.description}>
        <TextArea name="description" defaultValue={offer?.description} />
      </Field>
      <Field label="Allowed claims" name="allowedClaims" error={err.allowedClaims} hint="One per line. Drafts may only state claims listed here.">
        <TextArea name="allowedClaims" rows={4} defaultValue={offer?.allowed_claims.join("\n")} />
      </Field>
      <Field label="CTA options" name="ctaOptions" error={err.ctaOptions} hint="One per line.">
        <TextArea name="ctaOptions" rows={3} defaultValue={offer?.cta_options.join("\n")} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pending={pending}>{offer ? "Save offer" : "Create offer"}</SubmitButton>
    </form>
  );
}

export function CaseStudyForm({
  offerId,
  study,
}: {
  offerId: string;
  study?: { id: string; title: string; summary: string | null; industries: string[]; allowed_numbers: Record<string, number> };
}) {
  const { state, onSubmit: action, pending } = useActionForm(saveCaseStudy);
  const err = state.fieldErrors ?? {};
  const numbers = Object.entries(study?.allowed_numbers ?? {})
    .map(([k, v]) => `${k} = ${v}`)
    .join("\n");
  return (
    <form onSubmit={action} className="max-w-xl space-y-4" noValidate>
      <input type="hidden" name="offerId" value={offerId} />
      {study && <input type="hidden" name="id" value={study.id} />}
      <Field label="Case study title" name="title" error={err.title}>
        <TextInput name="title" defaultValue={study?.title} />
      </Field>
      <Field label="Summary" name="summary" error={err.summary}>
        <TextArea name="summary" defaultValue={study?.summary} />
      </Field>
      <Field label="Industries" name="industries" error={err.industries} hint="Comma separated">
        <TextInput name="industries" defaultValue={study?.industries.join(", ")} />
      </Field>
      <Field label="Allowed numbers" name="allowedNumbers" error={err.allowedNumbers} hint='One per line as "name = number". Drafts may only quote these figures.'>
        <TextArea name="allowedNumbers" rows={3} defaultValue={numbers} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pending={pending}>{study ? "Save case study" : "Add case study"}</SubmitButton>
    </form>
  );
}
