"use client";

import { Plus, Save } from "lucide-react";
import { Field, FormMessage, SubmitButton, TextArea, TextInput, useActionForm } from "@/components/form";
import { LinkButton } from "@/components/link-button";
import { Card, CardBody, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { saveCaseStudy, saveOffer } from "./actions";

export function OfferForm({
  offer,
}: {
  offer?: { id: string; name: string; description: string | null; allowed_claims: string[]; cta_options: string[] };
}) {
  const { state, onSubmit: action, pending } = useActionForm(saveOffer);
  const err = state.fieldErrors ?? {};
  return (
    <form onSubmit={action} className="max-w-3xl" noValidate>
      {offer && <input type="hidden" name="id" value={offer.id} />}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{offer ? "The offer" : "Describe the offer"}</CardTitle>
            <CardDescription>What you are offering, and the only things the emails are allowed to say about it.</CardDescription>
          </div>
        </CardHeader>
        <CardBody className="space-y-5">
          <Field label="Offer name" name="name" error={err.name}>
            <TextInput name="name" defaultValue={offer?.name} placeholder="For example: Extra development team" />
          </Field>
          <Field label="Description" name="description" error={err.description} hint="One or two sentences for yourself and your team.">
            <TextArea name="description" defaultValue={offer?.description} />
          </Field>
          <Field
            label="Allowed claims"
            name="allowedClaims"
            error={err.allowedClaims}
            hint="One per line. Drafts may only state claims listed here."
            help="A claim is something true about your offer, such as “We have shipped 40 mobile apps”. The emails may use these sentences and nothing else about you. If a claim is not listed here, an email that makes it fails the quality check."
          >
            <TextArea name="allowedClaims" rows={4} defaultValue={offer?.allowed_claims.join("\n")} />
          </Field>
          <Field
            label="CTA options"
            name="ctaOptions"
            error={err.ctaOptions}
            hint="One per line."
            help="CTA means call to action: the one thing the email asks the person to do at the end, for example “Would a 15 minute call next week suit you?”. List a few and the email picks one."
          >
            <TextArea name="ctaOptions" rows={3} defaultValue={offer?.cta_options.join("\n")} />
          </Field>
          <FormMessage state={state} />
        </CardBody>
        <CardFooter>
          <SubmitButton pending={pending} icon={<Save aria-hidden />}>
            {offer ? "Save offer" : "Create offer"}
          </SubmitButton>
          <LinkButton href="/setup?tab=offers" variant="outline">
            Cancel
          </LinkButton>
        </CardFooter>
      </Card>
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
    <form onSubmit={action} className="max-w-3xl" noValidate>
      <input type="hidden" name="offerId" value={offerId} />
      {study && <input type="hidden" name="id" value={study.id} />}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{study ? "Edit case study" : "Add a case study"}</CardTitle>
            <CardDescription>A real result for a past client. Emails may quote the figures listed here, and no others.</CardDescription>
          </div>
        </CardHeader>
        <CardBody className="space-y-5">
          <Field label="Case study title" name="title" error={err.title}>
            <TextInput name="title" defaultValue={study?.title} placeholder="For example: Fleet tracking app for a logistics firm" />
          </Field>
          <Field label="Summary" name="summary" error={err.summary}>
            <TextArea name="summary" defaultValue={study?.summary} />
          </Field>
          <Field label="Industries" name="industries" error={err.industries} hint="Comma separated" help="The kinds of business this case study fits. The email writer picks the case study closest to the company it is writing to.">
            <TextInput name="industries" defaultValue={study?.industries.join(", ")} />
          </Field>
          <Field
            label="Allowed numbers"
            name="allowedNumbers"
            error={err.allowedNumbers}
            hint='One per line as "name = number". Drafts may only quote these figures.'
            help="The figures an email may mention, for example “delivery time cut = 30”. Write one per line as a name, an equals sign and a number. A number that is not listed here makes the quality check fail."
          >
            <TextArea name="allowedNumbers" rows={3} defaultValue={numbers} />
          </Field>
          <FormMessage state={state} />
        </CardBody>
        <CardFooter>
          <SubmitButton pending={pending} icon={study ? <Save aria-hidden /> : <Plus aria-hidden />}>
            {study ? "Save case study" : "Add case study"}
          </SubmitButton>
          {study && (
            <LinkButton href={`/offers/${offerId}`} variant="outline">
              Cancel
            </LinkButton>
          )}
        </CardFooter>
      </Card>
    </form>
  );
}
