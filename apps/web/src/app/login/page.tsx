import { HealthBadge } from "@/components/health-badge";
import { getSupabasePublic } from "@/lib/env";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next = "" } = await searchParams;
  const configured = getSupabasePublic() !== null;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">AI Outreach Engine</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Sign in to continue.</p>
      </div>
      {configured ? (
        <LoginForm next={next} />
      ) : (
        <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Supabase is not configured, so sign-in is unavailable. Add NEXT_PUBLIC_SUPABASE_URL and
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env.
        </p>
      )}
      <div>
        <HealthBadge />
      </div>
    </main>
  );
}
