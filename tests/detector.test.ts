import { describe, it, expect } from "vitest";
import { buildListingEvents } from "../src/detector.js";
import type { SnapshotDiff } from "../src/state.js";

describe("buildListingEvents", () => {
  const now = "2026-05-18T12:00:00.000Z";

  it("builds perp event with leverage and mid", () => {
    const diff: SnapshotDiff = { newPerps: ["SOL"], newSpot: [] };
    const events = buildListingEvents(diff, {
      now,
      leverage: { SOL: 20 },
      mids: { SOL: 150.25 },
    });
    expect(events).toEqual([
      {
        symbol: "SOL",
        market: "perp",
        detectedAt: now,
        maxLeverage: 20,
        midPrice: 150.25,
        tradingUrl: "https://app.hyperliquid.xyz/trade/SOL",
      },
    ]);
  });

  it("builds spot event without leverage", () => {
    const diff: SnapshotDiff = { newPerps: [], newSpot: ["JEFF/USDC"] };
    const events = buildListingEvents(diff, { now, leverage: {}, mids: { "JEFF/USDC": 0.012 } });
    expect(events).toEqual([
      {
        symbol: "JEFF/USDC",
        market: "spot",
        detectedAt: now,
        midPrice: 0.012,
        tradingUrl: "https://app.hyperliquid.xyz/trade/JEFF/USDC",
      },
    ]);
  });

  it("handles missing mid price", () => {
    const diff: SnapshotDiff = { newPerps: ["NEW"], newSpot: [] };
    const events = buildListingEvents(diff, { now, leverage: { NEW: 10 }, mids: {} });
    expect(events[0].midPrice).toBeUndefined();
  });

  it("returns empty when no new symbols", () => {
    expect(buildListingEvents({ newPerps: [], newSpot: [] }, { now, leverage: {}, mids: {} })).toEqual([]);
  });
});
