// src/detector.ts
import type { ListingEvent } from "./types.js";
import type { SnapshotDiff } from "./state.js";

export type EnrichmentInput = {
  now: string;
  leverage: Record<string, number>;
  mids: Record<string, number>;
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
    const event: ListingEvent = {
      symbol,
      market: "spot",
      detectedAt: enrich.now,
      tradingUrl: `https://app.hyperliquid.xyz/trade/${symbol}`,
    };
    if (enrich.mids[symbol] !== undefined) event.midPrice = enrich.mids[symbol];
    events.push(event);
  }

  return events;
}
