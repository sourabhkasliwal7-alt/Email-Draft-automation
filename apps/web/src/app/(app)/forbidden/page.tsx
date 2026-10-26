import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";

export default async function ForbiddenPage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="Not allowed" />
      <p data-testid="forbidden" className="text-sm text-zinc-600 dark:text-zinc-400">
        Your role ({user.role}) does not have access to that page.
      </p>
    </>
  );
}
