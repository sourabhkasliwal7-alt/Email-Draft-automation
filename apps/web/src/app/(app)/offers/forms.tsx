"use client";

import { Plus, Save } from "lucide-react";
import { OFFER_TRIGGER_TYPES } from "@outreach/core";
import { Field, FormMessage, SubmitButton, TextArea, TextInput, useActionForm } from "@/components/form";
import { HelpTip } from "@/components/help-tip";
import { LinkButton } from "@/components/link-button";
import { Card, CardBody, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { saveCaseStudy, saveOffer } from "./actions";

export function OfferForm({
  offer,
}: {
  offer?: { id: string; name: string; description: string | null; allowed_claims: string[]; cta_options: string[]; match_terms: string[]; trigger_types: string[] };
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
          <Field
            label="Fits these businesses"
            name="matchTerms"
            error={err.matchTerms}
            hint="Business types, industries or keywords, comma separated. For example: agency, web design"
            help="When a campaign has several offers, each lead gets the offer whose words match the lead's business type or industry. Whole words are matched, ignoring capitals and plural endings (agency matches agencies). If no offer matches, the campaign's default offer is used."
          >
            <TextArea name="matchTerms" rows={2} defaultValue={offer?.match_terms.join(", ")} placeholder="agency, web design" />
          </Field>
          <fieldset className="space-y-2.5" data-field="triggerTypes" data-testid="offer-trigger-types">
            <legend className="flex items-center gap-1.5 text-sm font-medium">
              Fits best when the company shows this sign (optional)
              <HelpTip label="Trigger types">A trigger is a recent, checkable sign that the company may need you, such as hiring developers or raising funding. A matching trigger makes this offer more likely to be chosen. If you list no businesses above, the trigger alone decides.</HelpTip>
            </legend>
            <div className="flex flex-wrap gap-2">
              {OFFER_TRIGGER_TYPES.map((t) => (
                <label key={t.value} className="flex cursor-pointer items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm transition-colors hover:border-zinc-400 focus-within:ring-3 focus-within:ring-ring/30">
                  <input type="checkbox" name="triggerTypes" value={t.value} defaultChecked={offer?.trigger_types.includes(t.value)} className="size-4 rounded accent-[var(--brand)]" />
                  {t.label}
                </label>
              ))}
            </div>
          </fieldset>
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
