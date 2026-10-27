"use client";

import { Menu } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Nav, type NavItem } from "@/components/nav";
import { cn } from "@/lib/utils";

/**
 * The frame of every signed-in page: a fixed 240px sidebar (logo, the four pages, and at the bottom the health light, the user and
 * Sign out) and a main area that is the only thing that scrolls. Below the lg breakpoint the sidebar is a menu opened with the
 * hamburger button; it closes when you follow a link, press Escape or click outside it.
 * The server layout passes plain data (nav items) and ready elements (logo, footer); no component or function crosses over.
 */
export function AppShell({ items, logo, footer, children }: { items: NavItem[]; logo: React.ReactNode; footer: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    sidebar.current?.querySelector<HTMLElement>("a, button")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="h-dvh overflow-hidden">
      <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-card focus:px-4 focus:py-2 focus:shadow-pop">
        Skip to the page
      </a>

      <button
        ref={menuButton}
        type="button"
        className="fixed top-3 left-3 z-30 grid size-10 place-items-center rounded-lg border border-input bg-card text-foreground shadow-sm hover:bg-muted lg:hidden"
        aria-label="Open menu"
        aria-expanded={open}
        aria-controls="sidebar"
        data-testid="menu-button"
        onClick={() => setOpen(true)}
      >
        <Menu className="size-5" aria-hidden />
      </button>

      {open && <div className="fixed inset-0 z-40 bg-foreground/35 lg:hidden" aria-hidden onClick={() => setOpen(false)} />}

      <aside
        id="sidebar"
        ref={sidebar}
        aria-label="Menu"
        // following a link inside the menu closes it (on large screens `open` is never set, so this does nothing there)
        onClickCapture={(e) => {
          if ((e.target as HTMLElement).closest("a")) setOpen(false);
        }}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-60 flex-col gap-6 border-r bg-sidebar px-4 py-5 transition-[transform,visibility] duration-200",
          open ? "max-lg:translate-x-0 max-lg:shadow-pop" : "max-lg:invisible max-lg:-translate-x-full",
        )}
      >
        <div className="px-2">{logo}</div>
        <Nav items={items} />
        <div className="mt-auto flex flex-col gap-3">{footer}</div>
      </aside>

      <main id="content" tabIndex={-1} className="h-dvh min-w-0 overflow-y-auto outline-none lg:pl-60">
        <div className="page reveal">{children}</div>
      </main>
    </div>
  );
}
