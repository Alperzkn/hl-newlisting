import { describe, it, expect } from "vitest";
import { buildDexListingEvents, buildListingEvents } from "../src/detector.js";
import type { DexDiff, SnapshotDiff } from "../src/state.js";

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

  it("resolves @N spot names to BASE/QUOTE via spotDisplayNames", () => {
    const diff: SnapshotDiff = { newPerps: [], newSpot: ["@335"] };
    const events = buildListingEvents(diff, {
      now,
      leverage: {},
      mids: { "@335": 0.0123 },
      spotDisplayNames: { "@335": "HPL/USDC" },
    });
    expect(events).toEqual([
      {
        symbol: "HPL/USDC",
        market: "spot",
        detectedAt: now,
        midPrice: 0.0123,
        tradingUrl: "https://app.hyperliquid.xyz/trade/HPL/USDC",
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

describe("buildDexListingEvents", () => {
  const now = "2026-05-18T12:00:00.000Z";

  it("emits perp events with dex metadata and trading URL", () => {
    const diff: DexDiff = {
      dex: "xyz",
      fullName: "XYZ",
      newPerps: ["xyz:SPCX"],
      isNewDex: false,
    };
    const events = buildDexListingEvents(diff, {
      now,
      leverage: { "xyz:SPCX": 5 },
      mids: { "xyz:SPCX": 211.61 },
    });
    expect(events).toEqual([
      {
        symbol: "xyz:SPCX",
        market: "perp",
        dex: "xyz",
        dexFullName: "XYZ",
        detectedAt: now,
        maxLeverage: 5,
        midPrice: 211.61,
        tradingUrl: "https://app.hyperliquid.xyz/trade/xyz:SPCX",
      },
    ]);
  });

  it("emits nothing when the dex itself is brand new (baseline pass)", () => {
    const diff: DexDiff = {
      dex: "xyz",
      fullName: "XYZ",
      newPerps: ["xyz:A", "xyz:B"],
      isNewDex: true,
    };
    expect(buildDexListingEvents(diff, { now, leverage: {}, mids: {} })).toEqual([]);
  });
});
