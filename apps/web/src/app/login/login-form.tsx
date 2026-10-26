"use client";

import { Field, FormMessage, SubmitButton, TextInput, useActionForm } from "@/components/form";
import { sendMagicLink, signInWithPassword } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const { state, onSubmit: action, pending } = useActionForm(signInWithPassword);
  const { state: magic, onSubmit: magicAction, pending: magicPending } = useActionForm(sendMagicLink);
  return (
    <div className="space-y-8">
      <form onSubmit={action} className="space-y-4" noValidate>
        <input type="hidden" name="next" value={next} />
        <Field label="Email" name="email" error={state.fieldErrors?.email}>
          <TextInput name="email" type="email" autoComplete="username" />
        </Field>
        <Field label="Password" name="password" error={state.fieldErrors?.password}>
          <TextInput name="password" type="password" autoComplete="current-password" />
        </Field>
        <FormMessage state={state} />
        <SubmitButton pending={pending}>Sign in</SubmitButton>
      </form>

      <details className="rounded-md border p-3 text-sm">
        <summary className="cursor-pointer font-medium">Email me a sign-in link instead</summary>
        <form onSubmit={magicAction} className="mt-3 space-y-3" noValidate>
          <Field label="Email" name="magic-email" error={magic.fieldErrors?.email}>
            <input id="magic-email" name="email" type="email" className="w-full rounded-md border px-3 py-2 text-sm" />
          </Field>
          <FormMessage state={magic} />
          <SubmitButton variant="outline" pending={magicPending}>Send link</SubmitButton>
        </form>
      </details>
    </div>
  );
}
