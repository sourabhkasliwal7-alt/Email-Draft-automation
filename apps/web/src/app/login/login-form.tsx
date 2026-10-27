"use client";

import { Eye, EyeOff, LogIn, Mail, Send } from "lucide-react";
import { useState } from "react";
import { Field, FormMessage, SubmitButton, TextInput, inputClass, useActionForm } from "@/components/form";
import { sendMagicLink, signInWithPassword } from "./actions";

/** A password box with a button that shows the characters. The button is named so it does not clash with the field label. */
function PasswordBox({ name }: { name: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input id={name} name={name} type={shown ? "text" : "password"} autoComplete="current-password" className={`${inputClass} pr-11`} />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-pressed={shown}
        aria-label={shown ? "Hide characters" : "Show characters"}
        className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-lg text-zinc-500 outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
      >
        {shown ? <EyeOff className="size-[1.1rem]" aria-hidden /> : <Eye className="size-[1.1rem]" aria-hidden />}
      </button>
    </div>
  );
}

export function LoginForm({ next }: { next: string }) {
  const { state, onSubmit: action, pending } = useActionForm(signInWithPassword);
  const { state: magic, onSubmit: magicAction, pending: magicPending } = useActionForm(sendMagicLink);
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-xl tracking-tight">Welcome back</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">Use the email and password your administrator gave you.</p>
      </div>

      <form onSubmit={action} className="space-y-4" noValidate>
        <input type="hidden" name="next" value={next} />
        <Field label="Email" name="email" error={state.fieldErrors?.email}>
          <TextInput name="email" type="email" autoComplete="username" placeholder="you@company.com" />
        </Field>
        <Field label="Password" name="password" error={state.fieldErrors?.password}>
          <PasswordBox name="password" />
        </Field>
        <FormMessage state={state} />
        <div className="[&_button]:w-full">
          <SubmitButton pending={pending} icon={<LogIn aria-hidden />} size="lg">
            Sign in
          </SubmitButton>
        </div>
      </form>

      <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>

      <details className="group rounded-xl border bg-brand-soft/60 p-3.5 text-sm open:bg-card">
        <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-foreground [&::-webkit-details-marker]:hidden">
          <Mail className="size-4 text-primary" aria-hidden />
          Email me a sign-in link instead
        </summary>
        <form onSubmit={magicAction} className="mt-4 space-y-3" noValidate>
          <Field label="Email" name="magic-email" error={magic.fieldErrors?.email}>
            <input id="magic-email" name="email" type="email" placeholder="you@company.com" className={inputClass} />
          </Field>
          <FormMessage state={magic} />
          <SubmitButton variant="outline" pending={magicPending} icon={<Send aria-hidden />}>
            Send link
          </SubmitButton>
        </form>
      </details>
    </div>
  );
}
