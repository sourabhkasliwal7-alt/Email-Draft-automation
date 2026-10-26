"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/auth";
import { getSupabasePublic } from "@/lib/env";
import { validate } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";

const passwordSchema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
  next: z.string().default(""),
});

const magicSchema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
});

/** Only same-site relative paths are allowed as a post-login destination (no open redirect). */
function safeNext(next: string): string {
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : "/";
}

export async function signInWithPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!getSupabasePublic()) return { ok: false, message: "Supabase is not configured. Set the NEXT_PUBLIC_SUPABASE_* variables in .env." };
  const v = validate(passwordSchema, formData);
  if (!v.ok) return v.state;
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: v.data.email, password: v.data.password });
  // Same message for unknown user and wrong password: do not reveal which accounts exist.
  if (error) return { ok: false, message: "Invalid email or password." };
  redirect(safeNext(v.data.next));
}

/** Optional magic link. Never creates accounts: users are created by an admin. */
export async function sendMagicLink(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!getSupabasePublic()) return { ok: false, message: "Supabase is not configured." };
  const v = validate(magicSchema, formData);
  if (!v.ok) return v.state;
  const h = await headers();
  const origin = process.env.NEXT_PUBLIC_SITE_URL || h.get("origin") || `http://${h.get("host")}`;
  const supabase = await createClient();
  await supabase.auth.signInWithOtp({ email: v.data.email, options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/callback` } });
  // Always the same answer, whether or not the address belongs to a user.
  return { ok: true, message: "If that address belongs to a user, a sign-in link is on its way." };
}
