import { randomUUID } from "node:crypto";
import { ROLES, adminClient, e2eEmail, hasDb, type E2ERole } from "./support";

/**
 * Creates (or re-enables) one user per role with a brand-new random password, so no usable credential
 * survives between runs. Global teardown disables them again.
 */
export default async function globalSetup() {
  if (!hasDb()) {
    console.warn("[e2e] Supabase env missing: database-backed specs will be skipped.");
    return;
  }
  const pw = `${randomUUID()}-Aa1!`;
  process.env.E2E_PASSWORD = pw;
  const admin = adminClient();

  const roles: { key: E2ERole; role: (typeof ROLES)[number] }[] = [
    ...ROLES.map((r) => ({ key: r as E2ERole, role: r })),
    { key: "disabled", role: "operator" },
  ];
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  for (const { key, role } of roles) {
    const email = e2eEmail(key);
    const existing = list?.users.find((u) => u.email === email);
    let id = existing?.id;
    if (existing) {
      const { error } = await admin.auth.admin.updateUserById(existing.id, { password: pw, ban_duration: "none", email_confirm: true });
      if (error) throw error;
    } else {
      const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
      if (error) throw error;
      id = data.user.id;
    }
    const { error } = await admin
      .from("profiles")
      .upsert({ user_id: id!, role, full_name: `E2E ${key}`, disabled: false }, { onConflict: "user_id" });
    if (error) throw error;
  }
}
