"use client";

import { FileText, Home, Settings, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
}

/** Icons are chosen here, inside the client component: a server page only passes plain { href, label } data. */
const ICONS: Record<string, LucideIcon> = { "/": Home, "/leads": Users, "/drafts": FileText, "/setup": Settings };

/** The four menu items, each with an icon and a clear active state. */
export function Nav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {items.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = ICONS[item.href] ?? Home;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[0.95rem] font-medium transition-colors",
              active ? "bg-brand-tint text-accent-foreground shadow-[inset_3px_0_0_var(--brand)]" : "text-zinc-600 hover:bg-zinc-200/60 hover:text-foreground",
            )}
          >
            <Icon className={cn("size-5 shrink-0", active ? "text-brand" : "text-zinc-500 group-hover:text-foreground")} aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
