import { Card } from "@/components/ui/card";

/** Small drawings for the three steps. Plain inline SVG in the brand colours: no outside images. */
function AddLeadsArt() {
  return (
    <svg viewBox="0 0 132 92" className="h-24 w-auto" role="img" aria-label="A spreadsheet of leads with a plus sign">
      <rect x="10" y="12" width="82" height="62" rx="9" fill="#fff" stroke="#d3cfc3" strokeWidth="1.5" />
      <rect x="10" y="12" width="82" height="16" rx="9" fill="#e8f1ed" />
      <rect x="10" y="22" width="82" height="6" fill="#e8f1ed" />
      {[36, 48, 60].map((y) => (
        <g key={y}>
          <rect x="18" y={y} width="20" height="5" rx="2.5" fill="#cfd8d3" />
          <rect x="44" y={y} width="26" height="5" rx="2.5" fill="#e4e1d8" />
          <rect x="76" y={y} width="9" height="5" rx="2.5" fill="#e4e1d8" />
        </g>
      ))}
      <circle cx="98" cy="62" r="19" fill="#1f6b57" />
      <path d="M98 53v18M89 62h18" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" />
      <circle cx="108" cy="22" r="7" fill="none" stroke="#1f6b57" strokeWidth="2.4" />
      <path d="m113 27 7 7" stroke="#1f6b57" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

function StartRunArt() {
  return (
    <svg viewBox="0 0 132 92" className="h-24 w-auto" role="img" aria-label="A company website being read, with sparkles">
      <rect x="12" y="10" width="70" height="66" rx="9" fill="#fff" stroke="#d3cfc3" strokeWidth="1.5" />
      <circle cx="23" cy="21" r="2.4" fill="#d3cfc3" />
      <circle cx="31" cy="21" r="2.4" fill="#d3cfc3" />
      <circle cx="39" cy="21" r="2.4" fill="#d3cfc3" />
      <rect x="12" y="28" width="70" height="1.5" fill="#e4e1d8" />
      <rect x="20" y="36" width="40" height="6" rx="3" fill="#cfd8d3" />
      <rect x="20" y="48" width="54" height="4.5" rx="2.2" fill="#e4e1d8" />
      <rect x="20" y="57" width="46" height="4.5" rx="2.2" fill="#e4e1d8" />
      <rect x="20" y="66" width="30" height="4.5" rx="2.2" fill="#e4e1d8" />
      <rect x="20" y="46" width="54" height="8" rx="3" fill="#1f6b57" opacity="0.14" />
      <circle cx="92" cy="54" r="17" fill="#fff" stroke="#1f6b57" strokeWidth="3" />
      <path d="m104 66 14 14" stroke="#1f6b57" strokeWidth="5" strokeLinecap="round" />
      <path d="M86 54.5l4.2 4.2 8-9" fill="none" stroke="#1f6b57" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M112 14v10M107 19h10M122 34v6M119 37h6" stroke="#d99a2b" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function ReviewArt() {
  return (
    <svg viewBox="0 0 132 92" className="h-24 w-auto" role="img" aria-label="An email draft with a tick, waiting for you to send it">
      <rect x="14" y="14" width="88" height="62" rx="9" fill="#fff" stroke="#d3cfc3" strokeWidth="1.5" />
      <path d="m16 22 42 30 42-30" fill="none" stroke="#cfd8d3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="26" y="54" width="34" height="5" rx="2.5" fill="#e4e1d8" />
      <rect x="26" y="63" width="22" height="5" rx="2.5" fill="#e4e1d8" />
      <rect x="74" y="56" width="22" height="13" rx="6.5" fill="#e8f1ed" stroke="#1f6b57" strokeWidth="1.6" />
      <path d="M80 62.5h10" stroke="#1f6b57" strokeWidth="2" strokeLinecap="round" />
      <circle cx="106" cy="30" r="17" fill="#1f6b57" />
      <path d="m98 30 6 6 11-12" fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const STEPS = [
  { art: <AddLeadsArt />, title: "Add leads", text: "Upload a CSV file, let Apollo find people, or find companies on Google." },
  { art: <StartRunArt />, title: "Start run", text: "The tool reads each company's website and writes a short personal email for the people who fit." },
  { art: <ReviewArt />, title: "Review drafts in Gmail", text: "Read each draft and press Send yourself. Nothing is ever sent automatically." },
];

/** "How it works" in three steps, with a drawing for each. */
export function HowItWorks() {
  return (
    <Card className="mb-6 p-5 sm:p-6" data-testid="how-it-works" aria-labelledby="how-title">
      <h2 id="how-title" className="mb-4 text-lg font-semibold">
        How it works
      </h2>
      <ol className="grid gap-4 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-4 rounded-xl bg-brand-soft p-4 md:flex-col md:gap-3">
            <div className="grid shrink-0 place-items-center rounded-xl bg-card px-3 py-2 shadow-card md:self-stretch">{s.art}</div>
            <div>
              <p className="flex items-center gap-2 font-semibold text-foreground">
                <span className="grid size-6 place-items-center rounded-full bg-brand text-xs font-semibold text-white" aria-hidden>
                  {i + 1}
                </span>
                {s.title}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
