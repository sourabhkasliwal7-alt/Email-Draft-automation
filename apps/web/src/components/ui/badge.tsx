import { AlertTriangle, CheckCircle2, FlaskConical, Rocket } from "lucide-react";
import { cn } from "@/lib/utils";

export type Tone = "neutral" | "green" | "amber" | "red" | "brand";

const TONES: Record<Tone, string> = {
  neutral: "border-zinc-200 bg-zinc-100 text-zinc-700",
  green: "border-emerald-200 bg-emerald-50 text-emerald-800",
  amber: "border-amber-300 bg-amber-50 text-amber-900",
  red: "border-red-200 bg-red-50 text-red-700",
  brand: "border-brand bg-brand text-white",
};

/** A small rounded label. Colours mean the same thing everywhere: green = fine, amber = in progress or careful, red = look at it. */
export function Badge({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: Tone; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium", TONES[tone], className)}>{children}</span>;
}

export type Status = "ready" | "running" | "completed" | "attention" | "test" | "real";

const STATUS: Record<Status, { label: string; tone: Tone }> = {
  ready: { label: "Ready", tone: "green" },
  running: { label: "Running", tone: "amber" },
  completed: { label: "Completed", tone: "green" },
  attention: { label: "Needs attention", tone: "red" },
  test: { label: "Test run", tone: "amber" },
  real: { label: "Real run", tone: "brand" },
};

/** The six statuses of the app, always in the same colours: Ready, Running, Completed, Needs attention, Test run, Real run. */
export function StatusBadge({ status, children }: { status: Status; children?: React.ReactNode }) {
  const s = STATUS[status];
  const icon =
    status === "running" ? (
      <span data-motion className="size-2 rounded-full bg-amber-600" style={{ animation: "pulse-dot 1.6s ease-in-out infinite" }} aria-hidden />
    ) : status === "ready" ? (
      <span className="size-2 rounded-full bg-emerald-600" aria-hidden />
    ) : status === "completed" ? (
      <CheckCircle2 className="size-3.5" aria-hidden />
    ) : status === "attention" ? (
      <AlertTriangle className="size-3.5" aria-hidden />
    ) : status === "test" ? (
      <FlaskConical className="size-3.5" aria-hidden />
    ) : (
      <Rocket className="size-3.5" aria-hidden />
    );
  return (
    <Badge tone={s.tone}>
      {icon}
      {children ?? s.label}
    </Badge>
  );
}
