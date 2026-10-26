import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { config } from "dotenv";
import { ROLES, type Role } from "@outreach/core";
import { createServiceClient } from "@outreach/db";

export interface CreateUserArgs {
  email: string;
  role: Role;
  name: string | null;
  /** Explicit password from ADMIN_PASSWORD; null means "generate one for a new user, leave an existing user alone". */
  password: string | null;
  action: "create" | "disable" | "enable";
}

const USAGE = `Usage:
  pnpm user:create --email you@company.com --role admin|operator|reviewer|sender [--name "Full Name"]
  pnpm user:create --email you@company.com --disable
  pnpm user:create --email you@company.com --enable
  pnpm user:create            (reads ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_ROLE, ADMIN_NAME from .env; flags override)`;

/**
 * Pure argument parsing so it can be unit-tested. Flags win over the optional `env` fallbacks
 * (ADMIN_EMAIL / ADMIN_ROLE / ADMIN_NAME / ADMIN_PASSWORD). Throws an Error with the usage text on bad input.
 */
export function parseArgs(argv: string[], env: Record<string, string | undefined> = {}): CreateUserArgs {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const email = (get("--email") ?? env.ADMIN_EMAIL)?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`--email must be a valid address.\n${USAGE}`);
  if (argv.includes("--disable")) return { email, role: "operator", name: null, password: null, action: "disable" };
  if (argv.includes("--enable")) return { email, role: "operator", name: null, password: null, action: "enable" };
  const role = get("--role") ?? (env.ADMIN_ROLE?.trim() || undefined);
  if (!role || !(ROLES as readonly string[]).includes(role)) throw new Error(`--role must be one of ${ROLES.join(", ")}.\n${USAGE}`);
  const password = env.ADMIN_PASSWORD || null;
  if (password && password.length < 8) throw new Error("ADMIN_PASSWORD must be at least 8 characters.");
  return { email, role: role as Role, name: (get("--name") ?? env.ADMIN_NAME)?.trim() || null, password, action: "create" };
}

async function main() {
  config({ path: join(process.cwd(), "../../.env") });
  const args = parseArgs(process.argv.slice(2), process.env);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env");
  const db = createServiceClient(url, key);

  const { data: list, error: listError } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw listError;
  const existing = list.users.find((u) => u.email?.toLowerCase() === args.email);

  if (args.action !== "create") {
    if (!existing) throw new Error(`No user ${args.email}`);
    const disabled = args.action === "disable";
    const { error } = await db.from("profiles").update({ disabled }).eq("user_id", existing.id);
    if (error) throw error;
    await db.auth.admin.updateUserById(existing.id, { ban_duration: disabled ? "876000h" : "none" });
    console.log(`${args.email} ${disabled ? "disabled (access removed on the next request)" : "enabled"}.`);
    return;
  }

  let id = existing?.id;
  let generated: string | null = null;
  if (!existing) {
    generated = args.password ? null : randomBytes(18).toString("base64url");
    const password = args.password ?? generated!;
    const { data, error } = await db.auth.admin.createUser({ email: args.email, password, email_confirm: true });
    if (error) throw error;
    id = data.user.id;
  } else if (args.password) {
    const { error } = await db.auth.admin.updateUserById(existing.id, { password: args.password });
    if (error) throw error;
  }
  const { error } = await db
    .from("profiles")
    .upsert({ user_id: id!, role: args.role, full_name: args.name, disabled: false }, { onConflict: "user_id" });
  if (error) throw error;
  console.log(`${args.email} is now ${args.role}.`);
  if (generated) console.log(`One-time password (shown once, change it after signing in): ${generated}`);
  else if (args.password) console.log("Password set from ADMIN_PASSWORD.");
  else console.log("User already existed: password unchanged.");
}

// Only run when executed directly (so the test can import parseArgs).
if (process.argv[1] && /create-user\.(ts|js)$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
