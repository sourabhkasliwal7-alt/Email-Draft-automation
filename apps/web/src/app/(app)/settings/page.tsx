import { redirect } from "next/navigation";

/** This screen is part of Setup now. */
export default function SettingsRedirect() {
  redirect("/setup?tab=advanced");
}
