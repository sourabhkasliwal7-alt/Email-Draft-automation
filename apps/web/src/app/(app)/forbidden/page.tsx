import { Home, LockKeyhole } from "lucide-react";
import { LinkButton } from "@/components/link-button";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";

export default async function ForbiddenPage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="Not allowed" description="This part of the app is for other roles." />
      <div className="mt-8 flex max-w-xl items-start gap-4 rounded-2xl border bg-card p-6 shadow-card">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-800 ring-1 ring-amber-200" aria-hidden>
          <LockKeyhole className="size-5" />
        </span>
        <div className="space-y-4">
          <p data-testid="forbidden">Your role ({user.role}) does not have access to that page. If you need it, ask an administrator to change your role.</p>
          <LinkButton href="/" icon={<Home aria-hidden />}>
            Go to Home
          </LinkButton>
        </div>
      </div>
    </>
  );
}
