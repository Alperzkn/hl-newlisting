// src/detector.ts
import type { ListingEvent } from "./types.js";
import type { DexDiff, SnapshotDiff } from "./state.js";

export type EnrichmentInput = {
  now: string;
  leverage: Record<string, number>;
  mids: Record<string, number>;
  /** Maps canonical spot names like "@335" → "HPL/USDC" for display. */
  spotDisplayNames?: Record<string, string>;
  /** Base-token symbols already trading in a known spot pair (e.g. {"KNTQ","PURR"}). */
  knownSpotBases?: Set<string>;
};

export function buildListingEvents(diff: SnapshotDiff, enrich: EnrichmentInput): ListingEvent[] {
  const events: ListingEvent[] = [];

  for (const symbol of diff.newPerps) {
    const event: ListingEvent = {
      symbol,
      market: "perp",
      detectedAt: enrich.now,
      tradingUrl: `https://app.hyperliquid.xyz/trade/${symbol}`,
    };
    if (enrich.leverage[symbol] !== undefined) event.maxLeverage = enrich.leverage[symbol];
    if (enrich.mids[symbol] !== undefined) event.midPrice = enrich.mids[symbol];
    events.push(event);
  }

  for (const symbol of diff.newSpot) {
    const display = enrich.spotDisplayNames?.[symbol] ?? symbol;
    const event: ListingEvent = {
      symbol: display,
      market: "spot",
      detectedAt: enrich.now,
      tradingUrl: `https://app.hyperliquid.xyz/trade/${display}`,
    };
    const base = display.includes("/") ? display.split("/")[0] : undefined;
    if (base && enrich.knownSpotBases?.has(base)) {
      event.isNewQuotePair = true;
      event.baseToken = base;
    }
    if (enrich.mids[symbol] !== undefined) event.midPrice = enrich.mids[symbol];
    events.push(event);
  }

  return events;
}

export function buildDexListingEvents(diff: DexDiff, enrich: EnrichmentInput): ListingEvent[] {
  if (diff.isNewDex) return [];
  const events: ListingEvent[] = [];
  for (const symbol of diff.newPerps) {
    const event: ListingEvent = {
      symbol,
      market: "perp",
      dex: diff.dex,
      dexFullName: diff.fullName,
      detectedAt: enrich.now,
      tradingUrl: `https://app.hyperliquid.xyz/trade/${symbol}`,
    };
    if (enrich.leverage[symbol] !== undefined) event.maxLeverage = enrich.leverage[symbol];
    if (enrich.mids[symbol] !== undefined) event.midPrice = enrich.mids[symbol];
    events.push(event);
  }
  return events;
}
