export interface WorkerDeps {
  workerId: string;
  intervalMs: number;
  heartbeat: (workerId: string) => Promise<void>;
  log?: (msg: string) => void;
}

/**
 * Worker main loop. In Phase 4 the pg-boss queue + Mastra workflows are started from here; for now the
 * worker proves liveness by writing a heartbeat that the web health endpoint reads.
 */
export function startWorker({ workerId, intervalMs, heartbeat, log = console.log }: WorkerDeps) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = async () => {
    try {
      await heartbeat(workerId);
    } catch (e) {
      // A failed heartbeat must not kill the worker; the health endpoint will show it as stale.
      log(`heartbeat error: ${(e as Error).message}`);
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };

  const first = tick();
  return {
    first,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
