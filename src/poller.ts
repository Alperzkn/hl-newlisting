// src/poller.ts
import type { HlClient } from "./hl-client.js";
import type {
  AssetSnapshot,
  DexSnapshot,
  KnownAssets,
  ListingEvent,
  Notifier,
} from "./types.js";
import type { Logger } from "./logger.js";
import {
  baselineDex,
  diffDexSnapshot,
  diffSnapshot,
  isColdStart,
  readState,
  writeState,
} from "./state.js";
import { buildDexListingEvents, buildListingEvents } from "./detector.js";

export type PollerStatus = {
  lastPollAt: string;
  perpsCount: number;
  spotCount: number;
  dexCount: number;
  dexAssetsCount: number;
};

export type PollerDeps = {
  client: HlClient;
  notifier: Notifier;
  logger: Logger;
  stateFilePath: string;
  onListing?: (event: ListingEvent) => void;
};

export type Poller = {
  runTick(): Promise<void>;
  runDexSweep(): Promise<void>;
  start(opts: { pollIntervalMs: number; dexPollIntervalMs: number }): void;
  stop(): void;
  getStatus(): PollerStatus;
};

export function createPoller(deps: PollerDeps): Poller {
  let known: KnownAssets | null = null;
  let lastPollAt = new Date(0).toISOString();
  let mainInterval: NodeJS.Timeout | null = null;
  let dexInterval: NodeJS.Timeout | null = null;

  async function ensureLoaded(snapshot: AssetSnapshot) {
    if (known) return;
    if (await isColdStart(deps.stateFilePath)) {
      const now = new Date().toISOString();
      known = {
        perps: Object.fromEntries([...snapshot.perps].map((s) => [s, { firstSeen: now }])),
        spot: Object.fromEntries([...snapshot.spot].map((s) => [s, { firstSeen: now }])),
        dexPerps: {},
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
        known = { perps: {}, spot: {}, dexPerps: {}, lastPollAt: new Date().toISOString() };
        await writeState(deps.stateFilePath, known);
      }
    }
  }

  async function persistAndNotify(events: ListingEvent[]) {
    if (!known) return;
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
  }

  async function runTick() {
    try {
      const [meta, spotMeta] = await Promise.all([
        deps.client.fetchMeta(),
        deps.client.fetchSpotMeta(),
      ]);
      const snapshot: AssetSnapshot = { perps: meta.symbols, spot: spotMeta.symbols };
      lastPollAt = new Date().toISOString();

      await ensureLoaded(snapshot);
      if (!known) return;

      const diff = diffSnapshot(known, snapshot);
      if (diff.newPerps.length === 0 && diff.newSpot.length === 0) return;

      const mids = await deps.client.fetchAllMids().catch((err) => {
        deps.logger.warn("allMids fetch failed; proceeding without mids", { err: String(err) });
        return {} as Record<string, number>;
      });

      // Base tokens already trading in a known spot pair — used to flag new
      // quote pairs for existing tokens (e.g. KNTQ/USDC when KNTQ/USDH exists).
      const knownSpotBases = new Set<string>();
      for (const knownName of Object.keys(known.spot)) {
        const dn = spotMeta.displayNames[knownName];
        if (dn && dn.includes("/")) knownSpotBases.add(dn.split("/")[0]);
      }

      const events = buildListingEvents(diff, {
        now: lastPollAt,
        leverage: meta.leverage,
        mids,
        spotDisplayNames: spotMeta.displayNames,
        knownSpotBases,
      });

      for (const s of diff.newPerps) known.perps[s] = { firstSeen: lastPollAt };
      for (const s of diff.newSpot) known.spot[s] = { firstSeen: lastPollAt };
      await persistAndNotify(events);
    } catch (err) {
      deps.logger.warn("tick failed", { err: String(err) });
    }
  }

  async function runDexSweep() {
    if (!known) return;
    let dexes;
    try {
      dexes = await deps.client.fetchPerpDexs();
    } catch (err) {
      deps.logger.warn("perpDexs fetch failed", { err: String(err) });
      return;
    }

    const now = new Date().toISOString();
    const collectedEvents: ListingEvent[] = [];
    let midsCache: Record<string, number> | null = null;
    let dirty = false;

    for (const dex of dexes) {
      try {
        const meta = await deps.client.fetchMeta(dex.name);
        const snapshot: DexSnapshot = {
          dex: dex.name,
          fullName: dex.fullName,
          perps: meta.symbols,
          leverage: meta.leverage,
        };
        const diff = diffDexSnapshot(known, snapshot);

        if (diff.isNewDex) {
          known.dexPerps[dex.name] = baselineDex(dex.name, dex.fullName, snapshot.perps, now);
          dirty = true;
          deps.logger.info("new dex baselined (no alerts)", {
            dex: dex.name,
            fullName: dex.fullName,
            assets: snapshot.perps.size,
          });
          continue;
        }

        if (diff.newPerps.length === 0) continue;

        if (midsCache === null) {
          midsCache = await deps.client.fetchAllMids().catch((err) => {
            deps.logger.warn("allMids fetch failed in dex sweep", { err: String(err) });
            return {} as Record<string, number>;
          });
        }

        const events = buildDexListingEvents(diff, {
          now,
          leverage: snapshot.leverage,
          mids: midsCache,
        });

        const existing = known.dexPerps[dex.name];
        existing.fullName = dex.fullName;
        for (const s of diff.newPerps) existing.assets[s] = { firstSeen: now };
        dirty = true;

        collectedEvents.push(...events);
      } catch (err) {
        deps.logger.warn("dex tick failed", { dex: dex.name, err: String(err) });
      }
    }

    if (dirty) {
      lastPollAt = now;
      await persistAndNotify(collectedEvents);
    }
  }

  return {
    runTick,
    runDexSweep,
    start({ pollIntervalMs, dexPollIntervalMs }) {
      if (mainInterval || dexInterval) return;
      mainInterval = setInterval(() => void runTick(), pollIntervalMs);
      dexInterval = setInterval(() => void runDexSweep(), dexPollIntervalMs);
      void runTick();
      // Stagger the first dex sweep slightly so it doesn't race the cold-start tick.
      setTimeout(() => void runDexSweep(), Math.min(2000, pollIntervalMs));
    },
    stop() {
      if (mainInterval) {
        clearInterval(mainInterval);
        mainInterval = null;
      }
      if (dexInterval) {
        clearInterval(dexInterval);
        dexInterval = null;
      }
    },
    getStatus() {
      let dexAssetsCount = 0;
      let dexCount = 0;
      if (known) {
        dexCount = Object.keys(known.dexPerps).length;
        for (const d of Object.values(known.dexPerps)) {
          dexAssetsCount += Object.keys(d.assets).length;
        }
      }
      return {
        lastPollAt,
        perpsCount: known ? Object.keys(known.perps).length : 0,
        spotCount: known ? Object.keys(known.spot).length : 0,
        dexCount,
        dexAssetsCount,
      };
    },
  };
}
