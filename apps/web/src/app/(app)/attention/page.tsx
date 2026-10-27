import { redirect } from "next/navigation";

/** "Needs attention" is a tab on the Drafts page now. */
export default function AttentionRedirect() {
  redirect("/drafts?tab=attention");
}
