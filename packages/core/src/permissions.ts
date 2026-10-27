export const ROLES = ["admin", "operator", "reviewer", "sender"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Every capability the app checks. This matrix is the single source of truth for UI, pages and server actions;
 * the database enforces the same rules again through RLS (see supabase/migrations and supabase/tests/003).
 *
 * Key rule (SPEC 23.3): approving a draft for Gmail is NOT approval for sending.
 *  - reviewer: review, edit, regenerate, skip, approve a Gmail DRAFT only.
 *  - sender + admin: the only roles that approve SENDING or send.
 */
export const PERMISSIONS = {
  "dashboard.view": ["admin", "operator", "reviewer", "sender"],
  "campaign.view": ["admin", "operator", "reviewer", "sender"],
  "campaign.manage": ["admin", "operator"],
  "offer.view": ["admin", "operator", "reviewer", "sender"],
  "offer.manage": ["admin", "operator"],
  "import.use": ["admin", "operator"],
  "lead.view": ["admin", "operator", "reviewer", "sender"],
  "review.view": ["admin", "operator", "reviewer"],
  "draft.edit": ["admin", "operator", "reviewer"],
  "draft.approve_gmail": ["admin", "operator", "reviewer"],
  "lead.mark_dnc": ["admin", "operator", "reviewer"],
  "workflow.start": ["admin", "operator"],
  "run.view": ["admin", "operator"],
  "attention.view": ["admin", "operator", "reviewer"],
  "send.view": ["admin", "operator", "sender"],
  "send.approve": ["admin", "sender"],
  "send.execute": ["admin", "sender"],
  "followup.view": ["admin", "operator", "reviewer", "sender"],
  "suppression.view": ["admin", "operator", "reviewer", "sender"],
  "suppression.add": ["admin", "operator"],
  "suppression.remove": ["admin"],
  "inbox.view": ["admin", "operator"],
  "inbox.manage": ["admin"],
  "jobs.view": ["admin", "operator"],
  "cost.view": ["admin", "operator"],
  "settings.view": ["admin"],
  "settings.manage": ["admin"],
  "audit.view": ["admin"],
  "user.manage": ["admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
