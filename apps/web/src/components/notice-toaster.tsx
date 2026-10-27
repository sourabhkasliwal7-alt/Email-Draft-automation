"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { useToast } from "@/components/toast";
import { DRAFT_NOTICES, GMAIL_MESSAGES, SETUP_NOTICES } from "@/lib/notices";

/**
 * Pages that come back from a redirect carry a short code in the address (?gmail=connected, ?notice=retry_started).
 * This shows it as a toast once, then removes it from the address so a reload does not repeat it. The page itself still shows the message.
 */
export function NoticeToaster() {
  const params = useSearchParams();
  const pathname = usePathname();
  const toast = useToast();
  const shown = useRef("");

  const gmail = params.get("gmail");
  const notice = params.get("notice");
  useEffect(() => {
    const key = `${pathname}|${gmail ?? ""}|${notice ?? ""}`;
    if ((!gmail && !notice) || shown.current === key) return;
    shown.current = key;
    const g = gmail ? GMAIL_MESSAGES[gmail] : undefined;
    if (g) (g.tone === "ok" ? toast.success : toast.error)(g.text);
    const n = notice ? DRAFT_NOTICES[notice] : undefined;
    if (n) toast.success(n);
    const s = notice ? SETUP_NOTICES[notice] : undefined;
    if (s) (s.tone === "ok" ? toast.success : toast.error)(s.text);
    const rest = new URLSearchParams(window.location.search);
    rest.delete("gmail");
    rest.delete("notice");
    const query = rest.toString();
    window.history.replaceState(window.history.state, "", `${pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  }, [gmail, notice, pathname, toast]);

  return null;
}
