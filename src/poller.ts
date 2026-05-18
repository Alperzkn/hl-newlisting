// src/poller.ts
import type { HlClient } from "./hl-client.js";
import type { AssetSnapshot, KnownAssets, ListingEvent, Notifier } from "./types.js";
import type { Logger } from "./logger.js";
import { diffSnapshot, isColdStart, readState, writeState } from "./state.js";
import { buildListingEvents } from "./detector.js";

export type PollerDeps = {
  client: HlClient;
  notifier: Notifier;
  logger: Logger;
  stateFilePath: string;
  onListing?: (event: ListingEvent) => void; // for heartbeat reset
  getSnapshotForStatus?: () => { perpsCount: number; spotCount: number };
};

export type Poller = {
  runTick(): Promise<void>;
  start(intervalMs: number): void;
  stop(): void;
  getStatus(): { lastPollAt: string; perpsCount: number; spotCount: number };
};

export function createPoller(deps: PollerDeps): Poller {
  let known: KnownAssets | null = null;
  let lastPollAt = new Date(0).toISOString();
  let interval: NodeJS.Timeout | null = null;

  async function loadOrBaseline(snapshot: AssetSnapshot, leverage: Record<string, number>) {
    if (await isColdStart(deps.stateFilePath)) {
      const now = new Date().toISOString();
      known = {
        perps: Object.fromEntries([...snapshot.perps].map((s) => [s, { firstSeen: now }])),
        spot: Object.fromEntries([...snapshot.spot].map((s) => [s, { firstSeen: now }])),
        lastPollAt: now,
      };
      await writeState(deps.stateFilePath, known);
      deps.logger.info("cold start: baseline written", {
        perps: snapshot.perps.size,
        spot: snapshot.spot.size,
      });
    } else {
      known = await readState(deps.stateFilePath);
      if (!known) {
        // file existed at isColdStart check but read failed — treat as cold start
        known = { perps: {}, spot: {}, lastPollAt: new Date().toISOString() };
        await writeState(deps.stateFilePath, known);
      }
    }
  }

  async function runTick() {
    try {
      const [meta, spotMeta] = await Promise.all([
        deps.client.fetchMeta(),
        deps.client.fetchSpotMeta(),
      ]);
      const snapshot: AssetSnapshot = { perps: meta.symbols, spot: spotMeta.symbols };
      lastPollAt = new Date().toISOString();

      if (!known) {
        await loadOrBaseline(snapshot, meta.leverage);
        return;
      }

      const diff = diffSnapshot(known, snapshot);
      if (diff.newPerps.length === 0 && diff.newSpot.length === 0) return;

      // Fetch mids only when needed
      const mids = await deps.client.fetchAllMids().catch((err) => {
        deps.logger.warn("allMids fetch failed; proceeding without mids", { err: String(err) });
        return {} as Record<string, number>;
      });

      const events = buildListingEvents(diff, {
        now: lastPollAt,
        leverage: meta.leverage,
        mids,
      });

      // Persist BEFORE notifying so a crash mid-notify won't cause re-fire.
      for (const s of diff.newPerps) known.perps[s] = { firstSeen: lastPollAt };
      for (const s of diff.newSpot) known.spot[s] = { firstSeen: lastPollAt };
      known.lastPollAt = lastPollAt;
      await writeState(deps.stateFilePath, known);

      for (const e of events) {
        deps.logger.info("new listing", { event: e });
        try {
          await deps.notifier.notify(e);
          deps.onListing?.(e);
        } catch (err) {
          deps.logger.error("notifier threw despite fanout — should not happen", { err: String(err) });
        }
      }
    } catch (err) {
      deps.logger.warn("tick failed", { err: String(err) });
    }
  }

  return {
    runTick,
    start(intervalMs: number) {
      if (interval) return;
      interval = setInterval(() => void runTick(), intervalMs);
      void runTick(); // fire one immediately on start
    },
    stop() {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    },
    getStatus() {
      return {
        lastPollAt,
        perpsCount: known ? Object.keys(known.perps).length : 0,
        spotCount: known ? Object.keys(known.spot).length : 0,
      };
    },
  };
}
