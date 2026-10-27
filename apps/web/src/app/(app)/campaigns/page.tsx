import { redirect } from "next/navigation";

/** This screen is part of Setup now. */
export default function CampaignsRedirect() {
  redirect("/setup#campaign");
}
