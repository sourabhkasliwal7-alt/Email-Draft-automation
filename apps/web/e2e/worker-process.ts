import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import path from "node:path";

let child: ChildProcess | null = null;

/** Starts the real worker (job runner + heartbeat) so import jobs are processed during the e2e run. */
export function startWorkerProcess() {
  child = spawn("pnpm", ["exec", "tsx", "src/index.ts"], {
    cwd: path.resolve(__dirname, "../../worker"),
    env: { ...process.env, WORKER_ID: "e2e-worker", HEARTBEAT_INTERVAL_SECONDS: "5" },
    shell: true,
    stdio: "ignore",
  });
}

export function stopWorkerProcess() {
  if (!child?.pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGTERM");
  child = null;
}
