import { cache } from "react";
import { redirect } from "next/navigation";
import { can, isRole, type Permission, type Role } from "@outreach/core";
import { getSupabasePublic } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export interface CurrentUser {
  id: string;
  email: string;
  role: Role;
  fullName: string | null;
}

export type SessionState =
  | { state: "anonymous" }
  | { state: "not_configured" }
  | { state: "no_profile"; email: string }
  | { state: "disabled"; email: string }
  | { state: "ok"; user: CurrentUser };

export type ActionState = {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
};

/**
 * Data access layer for identity. Always asks Supabase Auth to validate the session (getUser) and reads the
 * profile through RLS, so a disabled user or a revoked role loses access on the very next request.
 */
export const getSession = cache(async (): Promise<SessionState> => {
  if (!getSupabasePublic()) return { state: "not_configured" };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { state: "anonymous" };
  const email = data.user.email ?? "";
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name, disabled")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (!profile || !isRole(profile.role)) return { state: "no_profile", email };
  if (profile.disabled) return { state: "disabled", email };
  return { state: "ok", user: { id: data.user.id, email, role: profile.role, fullName: profile.full_name } };
});

/**
 * Pure decision used by every server action: signed in, enabled, and holding the permission.
 * Kept separate from the I/O so the rules can be unit-tested for every role.
 */
export function evaluateGuard(session: SessionState, permission: Permission): { ok: true; user: CurrentUser } | { ok: false; state: ActionState } {
  if (session.state !== "ok") {
    return { ok: false, state: { ok: false, message: "Your session has ended or your access was removed. Sign in again." } };
  }
  if (!can(session.user.role, permission)) {
    return { ok: false, state: { ok: false, message: `Your role (${session.user.role}) is not allowed to do this.` } };
  }
  return { ok: true, user: session.user };
}

/** For pages: anonymous -> /login, disabled or profile-less -> /no-access, missing permission -> /forbidden. */
export async function requireUser(permission?: Permission): Promise<CurrentUser> {
  const s = await getSession();
  if (s.state === "anonymous" || s.state === "not_configured") redirect("/login");
  if (s.state === "no_profile" || s.state === "disabled") redirect(`/no-access?reason=${s.state}`);
  if (s.state !== "ok") redirect("/login");
  if (permission && !can(s.user.role, permission)) redirect("/forbidden");
  return s.user;
}

/** For server actions: never redirects, returns an error the form can show. Re-validates role on every call. */
export async function guardAction(permission: Permission) {
  const g = evaluateGuard(await getSession(), permission);
  if (!g.ok) return g;
  return { ok: true as const, user: g.user, supabase: await createClient() };
}
