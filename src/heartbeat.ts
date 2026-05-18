// src/heartbeat.ts
import type { HeartbeatStatus } from "./types.js";

export type HeartbeatOpts = {
  intervalMs: number;
  send: (text: string) => Promise<void>;
  status: () => HeartbeatStatus;
};

export type Heartbeat = {
  start(): void;
  stop(): void;
  reset(): void;
};

export function createHeartbeat(opts: HeartbeatOpts): Heartbeat {
  let timer: NodeJS.Timeout | null = null;

  const schedule = () => {
    timer = setTimeout(async () => {
      const s = opts.status();
      const text = `still alive — last poll ${s.lastPollAt} — tracking ${s.perpsCount} perps + ${s.spotCount} spot`;
      try {
        await opts.send(text);
      } catch {
        // swallow; heartbeat failure isn't critical
      }
      schedule();
    }, opts.intervalMs);
  };

  return {
    start: () => {
      if (!timer) schedule();
    },
    stop: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    reset: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      schedule();
    },
  };
}
