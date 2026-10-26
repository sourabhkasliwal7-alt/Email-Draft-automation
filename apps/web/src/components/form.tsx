"use client";

import { startTransition, useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/lib/auth";

export const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-300";

export function Field({
  label,
  name,
  error,
  hint,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1" data-field={name}>
      <label htmlFor={name} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-zinc-500">{hint}</p>}
      {error && (
        <p role="alert" data-testid={`error-${name}`} className="text-xs font-medium text-red-600">
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
  return (
    <input
      id={name}
      name={name}
      type={type}
      defaultValue={defaultValue ?? ""}
      placeholder={placeholder}
      autoComplete={autoComplete}
      className={inputClass}
    />
  );
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
    <select id={name} name={name} defaultValue={defaultValue ?? ""} className={inputClass}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Checkbox({ name, label, defaultChecked, value }: { name: string; label: string; defaultChecked?: boolean; value?: string }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} className="size-4 rounded border-zinc-300" />
      {label}
    </label>
  );
}

export function SubmitButton({
  children,
  pending = false,
  variant = "default",
}: {
  children: React.ReactNode;
  pending?: boolean;
  variant?: "default" | "outline" | "destructive";
}) {
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? "Working…" : children}
    </Button>
  );
}

/**
 * Wraps a server action for a form. Submits through onSubmit + a transition instead of the form `action` prop,
 * because React 19 resets every uncontrolled field after an action completes, which would erase what the user
 * typed whenever the server returns a validation error.
 */
export function useActionForm(serverAction: (prev: ActionState, formData: FormData) => Promise<ActionState>) {
  const [state, dispatch, pending] = useActionState(serverAction, {} as ActionState);
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(() => dispatch(formData));
  };
  return { state, onSubmit, pending };
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      data-testid="form-message"
      className={`rounded-md border px-3 py-2 text-sm ${
        state.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-red-300 bg-red-50 text-red-900"
      }`}
    >
      {state.message}
    </p>
  );
}
