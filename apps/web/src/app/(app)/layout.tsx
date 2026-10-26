import { can, type Permission } from "@outreach/core";
import { HealthBadge } from "@/components/health-badge";
import { Nav, type NavItem } from "@/components/nav";
import { requireUser } from "@/lib/auth";

const NAV: (NavItem & { permission: Permission })[] = [
  { href: "/", label: "Dashboard", permission: "dashboard.view" },
  { href: "/campaigns", label: "Campaigns", permission: "campaign.view" },
  { href: "/import", label: "Import", permission: "import.use" },
  { href: "/leads", label: "Leads", permission: "lead.view" },
  { href: "/review", label: "Review", permission: "review.view" },
  { href: "/sending", label: "Sending", permission: "send.view" },
  { href: "/follow-ups", label: "Follow-ups", permission: "followup.view" },
  { href: "/suppression", label: "Suppression", permission: "suppression.view" },
  { href: "/inboxes", label: "Inboxes", permission: "inbox.view" },
  { href: "/offers", label: "Offers", permission: "offer.view" },
  { href: "/jobs", label: "Jobs", permission: "jobs.view" },
  { href: "/usage", label: "Usage & Cost", permission: "cost.view" },
  { href: "/settings", label: "Settings", permission: "settings.view" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("dashboard.view");
  const items = NAV.filter((n) => can(user.role, n.permission)).map(({ href, label }) => ({ href, label }));
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col gap-6 border-r bg-zinc-50 p-4 dark:bg-zinc-950">
        <div className="text-lg font-semibold tracking-tight">Outreach Engine</div>
        <Nav items={items} />
        <div className="mt-auto space-y-3 text-xs text-zinc-600 dark:text-zinc-400">
          <HealthBadge />
          <div>
            <div data-testid="user-email" className="truncate font-medium text-zinc-900 dark:text-zinc-100">
              {user.email}
            </div>
            <div data-testid="user-role">{user.role}</div>
          </div>
          <form action="/auth/signout" method="post">
            <button type="submit" className="rounded-md border px-3 py-1.5 text-sm text-zinc-900 dark:text-zinc-100">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-8">{children}</main>
    </div>
  );
}
