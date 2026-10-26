import { HealthBadge } from "@/components/health-badge";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6">
      <h1 className="text-3xl font-semibold tracking-tight">AI Outreach Engine</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Research, draft and (after your explicit approval) send outreach from your own inboxes.
      </p>
      <div>
        <HealthBadge />
      </div>
    </main>
  );
}
