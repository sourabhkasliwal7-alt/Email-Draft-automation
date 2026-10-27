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
  /** the words on the button that takes you there */
  action: string;
  done: boolean;
  href: string;
}

/** The "Getting started" list on Home, in the order a new person should do it. */
export function buildChecklist(i: ChecklistInput): ChecklistStep[] {
  return [
    { key: "gmail", label: "Connect Gmail", action: "Connect Gmail", done: i.gmailConnected, href: "/setup?tab=gmail" },
    { key: "offer", label: "Add your offer", action: "Add offer", done: i.offers > 0, href: "/setup?tab=offers" },
    { key: "footer", label: "Fill in the email footer", action: "Fill footer", done: i.footerSet, href: "/setup?tab=footer" },
    { key: "campaign", label: "Create a campaign", action: "Create campaign", done: i.campaigns > 0, href: "/setup?tab=campaigns" },
    { key: "leads", label: "Add leads (CSV or Apollo)", action: "Add leads", done: i.leads > 0, href: "/leads" },
    { key: "run", label: "Start your first run", action: "Go to Start run", done: i.realRuns > 0, href: "#start" },
  ];
}

export const setupComplete = (steps: ChecklistStep[]): boolean => steps.every((s) => s.done);
