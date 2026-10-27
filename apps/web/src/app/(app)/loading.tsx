import { Skeleton } from "@/components/ui/skeleton";

/** Shown while any page of the app loads: a grey outline of a header and two cards. */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading">
      <div className="border-b py-4" data-page-header>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      </div>
      <div className="space-y-5">
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
        <Skeleton className="h-32 w-full rounded-2xl" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
