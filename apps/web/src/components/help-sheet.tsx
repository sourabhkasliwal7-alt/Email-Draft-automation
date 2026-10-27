import { LifeBuoy } from "lucide-react";
import { Sheet } from "@/components/sheet";

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "What is a test run?",
    a: (
      <>
        <p>A practice run. It looks at your leads, checks them and scores them, but it writes <strong>no drafts</strong> and uses <strong>no email credits</strong>.</p>
        <p className="mt-2">Do one first to see how many leads would pass. Then untick &ldquo;Test run&rdquo; and press Start run for the real thing.</p>
      </>
    ),
  },
  {
    q: "Why was a lead skipped?",
    a: (
      <>
        <p>The app only writes to people it can write to honestly. A lead is skipped when, for example:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>they are on your do-not-contact list, or we wrote to their company recently;</li>
          <li>their website could not be read, or we found nothing about them that can be quoted word for word;</li>
          <li>their score was below your cut-off, or their email address did not pass the check.</li>
        </ul>
        <p className="mt-2">Open Drafts &rarr; Needs attention to see the exact reason for each lead.</p>
      </>
    ),
  },
  {
    q: "Why is there no draft for a lead?",
    a: (
      <>
        <p>Usually one of three things: the lead was skipped (see above), it is waiting at a step that failed (it shows under Needs attention with a Retry button), or the run is still going.</p>
        <p className="mt-2">Drafts only appear in Gmail for leads that passed every check. Nothing is ever sent for you.</p>
      </>
    ),
  },
  {
    q: "How are email credits used?",
    a: (
      <>
        <p>Apollo charges one email credit when it unlocks a person&apos;s email address. The app does that only for leads that passed the checks, never twice for the same person, and never past the daily and monthly limits you set in Setup.</p>
        <p className="mt-2">Leads from a CSV file already have an email, so they use no credits. A test run uses none either.</p>
      </>
    ),
  },
];

/** A Help button that opens a side panel with the four questions people ask most. */
export function HelpSheet({ variant = "ghost" }: { variant?: "ghost" | "outline" }) {
  return (
    <Sheet title="Help" trigger={<span className="max-lg:sr-only">Help</span>} icon={<LifeBuoy aria-hidden />} variant={variant} size="sm" data-testid="help-button">
      <div className="space-y-3" data-testid="help-faq">
        {FAQ.map((f) => (
          <details key={f.q} className="group rounded-xl border bg-background px-4 py-3 open:bg-card open:shadow-card">
            <summary className="cursor-pointer list-none font-medium text-foreground marker:hidden [&::-webkit-details-marker]:hidden">
              <span className="flex items-center justify-between gap-3">
                {f.q}
                <span aria-hidden className="text-lg leading-none text-brand transition-transform group-open:rotate-45">+</span>
              </span>
            </summary>
            <div className="mt-3 text-sm text-muted-foreground">{f.a}</div>
          </details>
        ))}
        <p className="pt-2 text-xs text-muted-foreground">Still stuck? The run details on Home list what happened at every step.</p>
      </div>
    </Sheet>
  );
}
