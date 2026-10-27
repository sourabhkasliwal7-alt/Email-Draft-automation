import fs from "node:fs";
import { cleanupImportData, cleanupSimpleData } from "./db-cleanup";
import { AUTH_DIR, ROLES, adminClient, e2eEmail, hasDb } from "./support";
import { stopWorkerProcess } from "./worker-process";

/** Leaves no usable test account behind (disabled profile + banned auth user) and archives e2e data. */
export default async function globalTeardown() {
  stopWorkerProcess();
  fs.rmSync(AUTH_DIR, { recursive: true, force: true }); // saved sessions must not outlive the run
  if (!hasDb()) return;
  await cleanupImportData();
  await cleanupSimpleData();
  const admin = adminClient();
  const keys = [...ROLES, "disabled"] as const;
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  for (const key of keys) {
    const user = list?.users.find((u) => u.email === e2eEmail(key));
    if (!user) continue;
    await admin.from("profiles").update({ disabled: true }).eq("user_id", user.id);
    await admin.auth.admin.updateUserById(user.id, { ban_duration: "876000h" });
  }
  const now = new Date().toISOString();
  await admin.from("campaigns").update({ deleted_at: now, status: "archived" }).like("name", "e2e-%").is("deleted_at", null);
  await admin.from("case_studies").update({ deleted_at: now }).like("title", "e2e-%").is("deleted_at", null);
  await admin.from("offers").update({ deleted_at: now }).like("name", "e2e-%").is("deleted_at", null);
  await admin.from("suppression").delete().like("source", "e2e%");
  await admin.from("suppression").delete().like("reason", "e2e-%");
  await admin.from("settings").delete().eq("key", "e2e-placeholder");
}
