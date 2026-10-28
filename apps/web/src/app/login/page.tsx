import { FileSpreadsheet, MailCheck, SearchCheck, ShieldCheck } from "lucide-react";
import { HealthBadge } from "@/components/health-badge";
import { getSupabasePublic } from "@/lib/env";
import { LoginForm } from "./login-form";

const POINTS = [
  { icon: <FileSpreadsheet className="size-5" aria-hidden />, title: "Bring your leads", text: "Upload a CSV, let Apollo find people, or find companies on Google." },
  { icon: <SearchCheck className="size-5" aria-hidden />, title: "Researched, never invented", text: "Every fact in an email is quoted from the company's own pages." },
  { icon: <MailCheck className="size-5" aria-hidden />, title: "Drafts in your Gmail", text: "You read them and press Send yourself." },
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next = "" } = await searchParams;
  const configured = getSupabasePublic() !== null;
  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* brand side: deep pine, a few quiet shapes, the three promises */}
      <section className="relative isolate hidden overflow-hidden bg-[linear-gradient(155deg,#1f6b57_0%,#16503f_55%,#0f352a_100%)] text-white lg:flex lg:flex-col lg:justify-between lg:p-14">
        <svg aria-hidden className="pointer-events-none absolute inset-0 -z-10 size-full opacity-[0.16]" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice" fill="none" stroke="white" strokeWidth="1">
          <circle cx="520" cy="120" r="210" />
          <circle cx="520" cy="120" r="150" />
          <circle cx="520" cy="120" r="90" />
          <path d="M-40 640 C 120 560, 260 700, 420 620 S 640 560, 700 600" />
          <path d="M-40 690 C 120 610, 260 750, 420 670 S 640 610, 700 650" />
          <path d="M-40 740 C 120 660, 260 800, 420 720 S 640 660, 700 700" />
        </svg>
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-white/12 ring-1 ring-white/25" aria-hidden>
            <MailCheck className="size-5" />
          </span>
          <span className="font-heading text-lg tracking-tight">Outreach Engine</span>
        </div>

        <div className="max-w-md">
          <p className="text-sm font-medium tracking-wide text-emerald-200/90 uppercase">Cold email, done carefully</p>
          <p className="mt-3 font-heading text-[2.6rem] leading-[1.08] tracking-tight text-balance">Personal emails that are true, ready to send when you are.</p>
          <ul className="mt-10 space-y-6">
            {POINTS.map((p) => (
              <li key={p.title} className="flex gap-4">
                <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-lg bg-white/10 ring-1 ring-white/20">{p.icon}</span>
                <span>
                  <span className="block font-medium">{p.title}</span>
                  <span className="block text-sm text-emerald-100/85">{p.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="flex items-center gap-2 text-sm text-emerald-100/85">
          <ShieldCheck className="size-4 shrink-0" aria-hidden />
          Nothing is ever sent automatically.
        </p>
      </section>

      {/* sign-in side */}
      <section className="flex flex-col items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden" aria-hidden>
            <span className="grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <MailCheck className="size-5" />
            </span>
          </div>
          <h1 className="font-heading text-3xl tracking-tight">AI Outreach Engine</h1>
          <p className="mt-1.5 text-muted-foreground">Sign in to continue.</p>

          <div className="mt-8 rounded-2xl border bg-card p-6 shadow-card sm:p-7">
            {configured ? (
              <LoginForm next={next} />
            ) : (
              <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                Supabase is not configured, so sign-in is unavailable. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env, then restart.
              </p>
            )}
          </div>

          <div className="mt-6 flex items-center justify-between gap-3 text-sm text-muted-foreground">
            <HealthBadge />
            <span>Accounts are created by an administrator.</span>
          </div>
        </div>
      </section>
    </main>
  );
}
