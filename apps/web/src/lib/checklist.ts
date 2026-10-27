export interface ChecklistInput {
  gmailConnected: boolean;
  offers: number;
  footerSet: boolean;
  campaigns: number;
  leads: number;
  /** runs that were not test runs */
  realRuns: number;
}

export interface ChecklistStep {
  key: "gmail" | "offer" | "footer" | "campaign" | "leads" | "run";
  label: string;
  done: boolean;
  href: string;
}

/** The "Getting started" list on Home, in the order a new person should do it. */
export function buildChecklist(i: ChecklistInput): ChecklistStep[] {
  return [
    { key: "gmail", label: "Connect Gmail", done: i.gmailConnected, href: "/setup#mailboxes" },
    { key: "offer", label: "Add an offer", done: i.offers > 0, href: "/setup#offer" },
    { key: "footer", label: "Set the email footer", done: i.footerSet, href: "/setup#footer" },
    { key: "campaign", label: "Create a campaign", done: i.campaigns > 0, href: "/setup#campaign" },
    { key: "leads", label: "Add leads (CSV or Apollo)", done: i.leads > 0, href: "/leads" },
    { key: "run", label: "Start your first run", done: i.realRuns > 0, href: "#start" },
  ];
}

export const setupComplete = (steps: ChecklistStep[]): boolean => steps.every((s) => s.done);
