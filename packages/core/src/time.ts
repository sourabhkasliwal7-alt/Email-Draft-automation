export const DISPLAY_TZ = "Asia/Kolkata";

/** Timestamps are stored in UTC; always render them in Asia/Kolkata. */
export function formatKolkata(date: Date | string, opts: Intl.DateTimeFormatOptions = {}): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: DISPLAY_TZ,
    dateStyle: "medium",
    timeStyle: "short",
    ...opts,
  }).format(d);
}
