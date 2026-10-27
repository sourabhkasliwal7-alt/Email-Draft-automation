import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { Rocket } from "lucide-react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConfirmButton } from "@/components/confirm";
import { HelpSheet } from "@/components/help-sheet";
import { HelpTip } from "@/components/help-tip";
import { HowItWorks } from "@/components/how-it-works";
import { LinkButton } from "@/components/link-button";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Sheet } from "@/components/sheet";
import { StepBar } from "@/components/step-bar";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** Everything in src/ as { file, text }. */
function sources(dir = path.resolve(__dirname, "../src")): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push({ file: path.relative(path.resolve(__dirname, ".."), full).replaceAll("\\", "/"), text: readFileSync(full, "utf8") });
  }
  return out;
}

const isClientFile = (text: string) => /^\s*(\/\*[\s\S]*?\*\/\s*)?["']use client["']/.test(text);

describe("server -> client boundary (static)", () => {
  const all = sources();
  const tsx = all.filter((s) => s.file.endsWith(".tsx"));

  it("never passes an icon as a bare component (icon={Rocket}); pass an element such as icon={<Rocket />}", () => {
    const bad = tsx.filter((s) => /\bicon=\{\s*[A-Z]/.test(s.text)).map((s) => s.file);
    expect(bad).toEqual([]);
  });

  it("never passes any component or function reference by name as a JSX prop value from a server file", () => {
    // `prop={Component}` in a file that is not a client file crosses the boundary as a function and fails at runtime
    const bad = tsx.filter((s) => !isClientFile(s.text) && /\b(?!action\b)[a-z][A-Za-z-]*=\{\s*[A-Z][A-Za-z0-9]*\s*\}/.test(s.text)).map((s) => s.file);
    expect(bad).toEqual([]);
  });

  it("no prop type asks for an icon component (icon?: LucideIcon); the prop is a ReactNode", () => {
    const bad = all.filter((s) => /\bicon\??:\s*(LucideIcon|React\.ComponentType|ComponentType|React\.ElementType)/.test(s.text)).map((s) => s.file);
    expect(bad).toEqual([]);
  });

  it("files that use React or Next client hooks start with 'use client' (next/link is fine in server files)", () => {
    const hooks = /\b(useState|useEffect|useLayoutEffect|useRef|useReducer|useContext|useActionState|useFormStatus|useTransition|useOptimistic|usePathname|useRouter|useSearchParams|useParams|useId)\s*\(/;
    // files that only export plain helpers a client file imports are still fine: what matters is that a hook is never run in a server file
    const bad = tsx.filter((s) => hooks.test(s.text) && !isClientFile(s.text)).map((s) => s.file);
    expect(bad).toEqual([]);
  });

  it("event handlers (onClick, onChange, onSubmit ...) only appear in client files", () => {
    const bad = tsx.filter((s) => /\bon(Click|Change|Submit|Input|KeyDown|Select|Toggle|Close|Cancel)=\{/.test(s.text) && !isClientFile(s.text)).map((s) => s.file);
    expect(bad).toEqual([]);
  });
});

describe("server-side components render without throwing", () => {
  it("renders the shared kit with icons passed as elements", () => {
    const html = renderToString(
      <div>
        <PageHeader title="Home" description="One sentence." actions={<LinkButton href="/setup?tab=gmail" icon={<Rocket />}>Go</LinkButton>} />
        <EmptyState icon={<Rocket />} action={<Button icon={<Rocket />}>Create</Button>}>
          Nothing here yet.
        </EmptyState>
        <EmptyState>Default icon.</EmptyState>
        <Badge tone="amber">No offer selected</Badge>
        <StatusBadge status="ready" />
        <StatusBadge status="attention">Needs attention</StatusBadge>
        <StepBar steps={[{ key: "found", label: "Found", count: 3 }, { key: "checked", label: "Checked", count: 2 }]} active="checked" />
        <HowItWorks />
        <HelpTip label="cut-off">Leads below this score are skipped.</HelpTip>
      </div>,
    );
    expect(html).toContain("Home");
    expect(html).toContain("No offer selected");
    expect(html).toContain("How it works");
  });

  it("renders HelpSheet (a Server Component) with the Help trigger and the FAQ", () => {
    const html = renderToString(<HelpSheet />);
    expect(html).toContain("Help");
    expect(html).toContain("What is a test run?");
    expect(html).toContain("<svg"); // the LifeBuoy icon reached the button as an element
  });

  it("renders the client wrappers a server page uses: Sheet and ConfirmButton with element icons and plain-object content", () => {
    const html = renderToString(
      <form>
        <Sheet title="Panel" trigger="Open" icon={<Rocket />}>
          <p>Body</p>
        </Sheet>
        <ConfirmButton icon={<Rocket />} confirm={{ title: "Sure?", confirmLabel: "Yes", tone: "danger", body: <p>This cannot be undone.</p> }}>
          Skip
        </ConfirmButton>
      </form>,
    );
    expect(html).toContain("Panel");
    expect(html).toContain("confirm-yes"); // the dialog content itself is filled in when the button is pressed
  });
});
