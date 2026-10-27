import { redirect } from "next/navigation";

/** Mailboxes moved to Setup. A return from Google (?gmail=...) keeps its message. */
export default async function InboxesRedirect({ searchParams }: { searchParams: Promise<{ gmail?: string }> }) {
  const { gmail } = await searchParams;
  redirect(`/setup${gmail ? `?gmail=${encodeURIComponent(gmail)}` : ""}#mailboxes`);
}
