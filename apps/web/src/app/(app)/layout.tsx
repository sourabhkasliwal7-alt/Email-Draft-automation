import { LogOut } from "lucide-react";
import { can, type Permission } from "@outreach/core";
import { AppShell } from "@/components/app-shell";
import { HealthBadge } from "@/components/health-badge";
import { HelpSheet } from "@/components/help-sheet";
import type { NavItem } from "@/components/nav";
import { requireUser } from "@/lib/auth";

const NAV: (NavItem & { permission: Permission })[] = [
  { href: "/", label: "Home", permission: "dashboard.view" },
  { href: "/leads", label: "Leads", permission: "lead.view" },
  { href: "/drafts", label: "Drafts", permission: "drafts.view" },
  { href: "/setup", label: "Setup", permission: "setup.view" },
];

/** The app's mark: an envelope in the brand colour. */
function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect x="1.5" y="5" width="29" height="22" rx="6" fill="var(--brand)" />
      <path d="M5.5 10.5 16 18l10.5-7.5" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("dashboard.view");
  const items = NAV.filter((n) => can(user.role, n.permission)).map(({ href, label }) => ({ href, label }));
  return (
    <AppShell
      items={items}
      logo={
        <div className="flex items-center gap-2.5">
          <Mark className="size-8 shrink-0" />
          <span className="font-heading text-xl leading-none font-semibold tracking-tight">Outreach Engine</span>
        </div>
      }
      footer={
        <>
          <div className="flex items-center justify-between gap-2">
            <HealthBadge />
            <HelpSheet />
          </div>
          <div className="rounded-xl border bg-card p-3">
            <div data-testid="user-email" className="truncate text-sm font-medium text-foreground" title={user.email}>
              {user.email}
            </div>
            <div data-testid="user-role" className="text-xs text-muted-foreground capitalize">
              {user.role}
            </div>
            <form action="/auth/signout" method="post" className="mt-3">
              <button
                type="submit"
                className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-input bg-card px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted"
              >
                <LogOut className="size-4" aria-hidden />
                Sign out
              </button>
            </form>
          </div>
        </>
      }
    >
      {children}
    </AppShell>
  );
}
