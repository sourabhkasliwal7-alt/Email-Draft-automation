"use client";

import { AlertCircle, CheckCircle2 } from "lucide-react";
import { startTransition, useActionState, useEffect } from "react";
import { HelpTip } from "@/components/help-tip";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/lib/auth";

export const inputClass =
  "w-full rounded-lg border border-input bg-card px-3.5 py-2.5 text-sm text-foreground shadow-sm outline-none transition-[border-color,box-shadow] placeholder:text-zinc-400 hover:border-zinc-400 focus:border-brand focus:ring-3 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";

/** A labelled field. `help` adds a (?) with a plain explanation next to the label. */
export function Field({
  label,
  name,
  error,
  hint,
  help,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  help?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5" data-field={name}>
      <div className="flex items-center gap-1.5">
        <label htmlFor={name} className="block text-sm font-medium text-foreground">
          {label}
        </label>
        {help && <HelpTip label={label}>{help}</HelpTip>}
      </div>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p role="alert" data-testid={`error-${name}`} className="text-xs font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextInput({
  name,
  defaultValue,
  type = "text",
  placeholder,
  autoComplete,
}: {
  name: string;
  defaultValue?: string | number | null;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
}) {
  return <input id={name} name={name} type={type} defaultValue={defaultValue ?? ""} placeholder={placeholder} autoComplete={autoComplete} className={inputClass} />;
}

export function TextArea({ name, defaultValue, rows = 3, placeholder }: { name: string; defaultValue?: string | null; rows?: number; placeholder?: string }) {
  return <textarea id={name} name={name} rows={rows} defaultValue={defaultValue ?? ""} placeholder={placeholder} className={inputClass} />;
}

export function SelectInput({
  name,
  defaultValue,
  options,
}: {
  name: string;
  defaultValue?: string | null;
  options: { value: string; label: string }[];
}) {
  return (
    <select id={name} name={name} defaultValue={defaultValue ?? ""} className={`${inputClass} pr-9`}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Checkbox({
  name,
  label,
  defaultChecked,
  value,
  disabled,
  help,
  description,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
  value?: string;
  disabled?: boolean;
  help?: React.ReactNode;
  /** one line under the label that says what ticking it does */
  description?: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <label className="flex cursor-pointer items-start gap-2.5 text-sm">
        <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} disabled={disabled} className="mt-0.5 size-[1.1rem] shrink-0 rounded border-input accent-[var(--brand)] disabled:cursor-not-allowed" />
        <span>
          <span className="font-medium text-foreground">{label}</span>
          {description && <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>}
        </span>
      </label>
      {help && <HelpTip label={label}>{help}</HelpTip>}
    </div>
  );
}

/** The submit button of a form: Primary by default, with a spinner while the form is working. */
export function SubmitButton({
  children,
  pending = false,
  variant = "default",
  icon,
  size,
  testId,
}: {
  children: React.ReactNode;
  pending?: boolean;
  variant?: "default" | "outline" | "destructive";
  icon?: React.ReactNode;
  size?: "default" | "sm" | "lg";
  testId?: string;
}) {
  return (
    <Button type="submit" variant={variant} size={size} icon={icon} pending={pending} data-testid={testId}>
      {children}
    </Button>
  );
}

/**
 * Wraps a server action for a form. Submits through onSubmit + a transition instead of the form `action` prop,
 * because React 19 resets every uncontrolled field after an action completes, which would erase what the user
 * typed whenever the server returns a validation error. Every answer from the server also appears as a toast.
 */
export function useActionForm(serverAction: (prev: ActionState, formData: FormData) => Promise<ActionState>) {
  const [state, dispatch, pending] = useActionState(serverAction, {} as ActionState);
  const toast = useToast();
  useEffect(() => {
    if (!state.message) return;
    if (state.ok) toast.success(state.message);
    else toast.error(state.message);
  }, [state, toast]);
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(() => dispatch(formData));
  };
  return { state, onSubmit, pending };
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state.message) return null;
  const Icon = state.ok ? CheckCircle2 : AlertCircle;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      data-testid="form-message"
      className={`flex items-start gap-2 rounded-lg border px-3.5 py-2.5 text-sm ${state.ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-800"}`}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{state.message}</span>
    </p>
  );
}
