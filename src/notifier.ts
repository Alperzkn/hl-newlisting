// src/notifier.ts
import type { ListingEvent, Notifier } from "./types.js";

export type FanoutOpts = {
  onError: (err: unknown, event: ListingEvent) => void;
};

export function createFanoutNotifier(children: Notifier[], opts: FanoutOpts): Notifier {
  return {
    async notify(event: ListingEvent) {
      await Promise.all(
        children.map((c) => c.notify(event).catch((err) => opts.onError(err, event)))
      );
    },
  };
}
