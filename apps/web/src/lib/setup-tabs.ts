/** Setup is one page with tabs: /setup?tab=gmail|apollo|campaigns|offers|footer|style|schedule|advanced (default gmail). */
export const SETUP_TABS = [
  { key: "gmail", label: "Gmail" },
  { key: "apollo", label: "Apollo" },
  { key: "campaigns", label: "Campaigns" },
  { key: "offers", label: "Offers" },
  { key: "footer", label: "Email footer" },
  { key: "style", label: "Email style" },
  { key: "schedule", label: "Schedule" },
  { key: "advanced", label: "Advanced" },
] as const;

export type SetupTab = (typeof SETUP_TABS)[number]["key"];

export const DEFAULT_SETUP_TAB: SetupTab = "gmail";

/** Any unknown or missing value falls back to the first tab. */
export function parseSetupTab(value: string | string[] | undefined): SetupTab {
  const v = Array.isArray(value) ? value[0] : value;
  return SETUP_TABS.find((t) => t.key === v)?.key ?? DEFAULT_SETUP_TAB;
}

export const setupTabHref = (tab: SetupTab): string => `/setup?tab=${tab}`;

/** The one sentence under the page title for each tab. */
export const SETUP_INSTRUCTIONS: Record<SetupTab, string> = {
  gmail: "Connect the Gmail account your drafts are saved in. Only drafts are created: nothing is ever sent.",
  apollo: "Apollo finds the people to write to. Add your key to use real data, or stay in practice mode.",
  campaigns: "A campaign says who to write to, which offer to write about and which mailbox saves the drafts.",
  offers: "An offer is what you sell. Emails may only make the claims and quote the numbers you list here.",
  footer: "The footer goes at the bottom of every email: where you are and how to opt out.",
  style: "How the emails sound: the tools named for each industry, your best sample emails, and how they are signed.",
  schedule: "Let a run start by itself on weekdays, or press Start run on Home whenever you want.",
  advanced: "Technical settings. The defaults work; change them only if you know why.",
};

/** "done" = green tick, "todo" = orange dot (needs action), "none" = nothing to show. */
export type TabMark = "done" | "todo" | "none";

export interface SetupFacts {
  /** at least one mailbox is connected and none needs reconnecting */
  gmailReady: boolean;
  /** an Apollo key is set and Apollo is switched to live data */
  apolloLive: boolean;
  campaigns: number;
  offers: number;
  /** postal address and opt-out line are filled in */
  footerSet: boolean;
  scheduleOn: boolean;
}

/** Which mark each tab shows. Advanced never shows one; the schedule is optional so it is ticked when on and otherwise quiet. */
export function setupTabMarks(f: SetupFacts): Record<SetupTab, TabMark> {
  const yes = (done: boolean): TabMark => (done ? "done" : "todo");
  return {
    gmail: yes(f.gmailReady),
    apollo: yes(f.apolloLive),
    campaigns: yes(f.campaigns > 0),
    offers: yes(f.offers > 0),
    footer: yes(f.footerSet),
    style: "none",
    schedule: f.scheduleOn ? "done" : "none",
    advanced: "none",
  };
}

/** The yellow banner on the Gmail tab: shown only when something needs doing, otherwise null. */
export function gmailBanner(mailboxes: { email: string; status: string; hasLabelPermission: boolean; expiresAt: Date | null }[], now: Date = new Date()): string | null {
  const needs = mailboxes.filter((m) => m.status === "needs_reconnect" || (m.status === "active" && !m.hasLabelPermission));
  const who = (list: { email: string }[]) => (list.length === 1 ? list[0].email : `${list.length} mailboxes`);
  if (needs.length) return `${who(needs)} must be reconnected before drafts can be saved. Press Reconnect on the card below.`;
  const soon = mailboxes.filter((m) => m.status === "active" && m.expiresAt && m.expiresAt.getTime() - now.getTime() <= 2 * 86_400_000);
  if (soon.length) return `The Gmail sign-in of ${who(soon)} expires within 2 days. Reconnect it so drafts keep working.`;
  return null;
}
