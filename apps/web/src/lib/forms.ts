import type { ZodType, ZodError } from "zod";
import type { ActionState } from "@/lib/auth";

interface FormShape {
  /** keys that may appear several times (checkbox groups) -> string[] */
  arrays?: string[];
  /** checkbox keys -> boolean (present = true) */
  booleans?: string[];
}

export function formObject(fd: FormData, { arrays = [], booleans = [] }: FormShape = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(fd.keys())) {
    if (key.startsWith("$ACTION")) continue; // React server-action bookkeeping fields
    out[key] = arrays.includes(key) ? fd.getAll(key).map(String) : String(fd.get(key) ?? "");
  }
  for (const key of arrays) out[key] ??= [];
  for (const key of booleans) out[key] = fd.has(key);
  return out;
}

export function zodFieldErrors(error: ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    errors[key] ??= issue.message;
  }
  return errors;
}

export function validate<T>(
  schema: ZodType<T>,
  fd: FormData,
  shape?: FormShape,
): { ok: true; data: T } | { ok: false; state: ActionState } {
  const r = schema.safeParse(formObject(fd, shape));
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, state: { ok: false, message: "Please fix the highlighted fields.", fieldErrors: zodFieldErrors(r.error) } };
}

/** Postgres / PostgREST errors -> something a person can act on. */
export function dbErrorMessage(error: { code?: string; message: string }): string {
  if (error.code === "23505") return "That already exists.";
  if (error.code === "42501") return "You do not have permission to do this.";
  if (error.code === "23503") return "This is still in use by other records.";
  return error.message;
}
