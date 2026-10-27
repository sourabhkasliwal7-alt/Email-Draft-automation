export const STATUS_TONE: Record<string, "amber" | "green" | "neutral"> = { running: "amber", paused: "amber", completed: "green", cancelled: "neutral" };

export const PAUSE_TEXT: Record<string, string> = {
  time_limit: "stopped at the run time limit: press Resume to continue (finished steps are not repeated)",
  cap: "a spend limit was reached",
  missing_price: "a price is missing in Settings",
  manual: "stopped: see the log",
  campaign_paused: "the campaign was paused",
  worker_stopping: "the worker was stopped",
};
