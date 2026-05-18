import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  baselineDex,
  diffDexSnapshot,
  diffSnapshot,
  isColdStart,
  readState,
  writeState,
} from "../src/state.js";
import type { KnownAssets } from "../src/types.js";

let tmpDir: string;
let stateFile: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hl-state-"));
  stateFile = path.join(tmpDir, "state.json");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("isColdStart", () => {
  it("returns true when state file does not exist", async () => {
    expect(await isColdStart(stateFile)).toBe(true);
  });

  it("returns false when state file exists", async () => {
    await fs.writeFile(stateFile, "{}");
    expect(await isColdStart(stateFile)).toBe(false);
  });
});

describe("readState", () => {
  it("returns null when file does not exist", async () => {
    expect(await readState(stateFile)).toBeNull();
  });

  it("returns parsed state when file exists", async () => {
    const data: KnownAssets = {
      perps: { BTC: { firstSeen: "2024-01-01T00:00:00.000Z" } },
      spot: {},
      dexPerps: {},
      lastPollAt: "2024-01-01T00:00:00.000Z",
    };
    await fs.writeFile(stateFile, JSON.stringify(data));
    const loaded = await readState(stateFile);
    expect(loaded).toEqual(data);
  });

  it("migrates older state files lacking dexPerps", async () => {
    await fs.writeFile(
      stateFile,
      JSON.stringify({
        perps: { BTC: { firstSeen: "t0" } },
        spot: {},
        lastPollAt: "t0",
      })
    );
    const loaded = await readState(stateFile);
    expect(loaded).toEqual({
      perps: { BTC: { firstSeen: "t0" } },
      spot: {},
      dexPerps: {},
      lastPollAt: "t0",
    });
  });
});

describe("writeState", () => {
  it("creates the state file with correct content", async () => {
    const data: KnownAssets = {
      perps: { ETH: { firstSeen: "2024-02-01T00:00:00.000Z" } },
      spot: { PURR: { firstSeen: "2024-02-01T00:00:00.000Z" } },
      dexPerps: {},
      lastPollAt: "2024-02-01T00:00:00.000Z",
    };
    await writeState(stateFile, data);
    const roundTripped = await readState(stateFile);
    expect(roundTripped).toEqual(data);
  });

  it("creates parent directories if missing", async () => {
    const nested = path.join(tmpDir, "a", "b", "c", "state.json");
    const data: KnownAssets = { perps: {}, spot: {}, dexPerps: {}, lastPollAt: "x" };
    await writeState(nested, data);
    expect(await readState(nested)).toEqual(data);
  });

  it("does not leave a .tmp file behind on success", async () => {
    const data: KnownAssets = { perps: {}, spot: {}, dexPerps: {}, lastPollAt: "x" };
    await writeState(stateFile, data);
    const entries = await fs.readdir(tmpDir);
    expect(entries).toContain(path.basename(stateFile));
    expect(entries).not.toContain(`${path.basename(stateFile)}.tmp`);
  });
});

describe("diffSnapshot", () => {
  const known: KnownAssets = {
    perps: { BTC: { firstSeen: "t0" }, ETH: { firstSeen: "t0" } },
    spot: { PURR: { firstSeen: "t0" } },
    dexPerps: {},
    lastPollAt: "t0",
  };

  it("returns empty arrays when snapshot matches known", () => {
    const result = diffSnapshot(known, { perps: new Set(["BTC", "ETH"]), spot: new Set(["PURR"]) });
    expect(result.newPerps).toEqual([]);
    expect(result.newSpot).toEqual([]);
  });

  it("returns new perp symbols", () => {
    const result = diffSnapshot(known, {
      perps: new Set(["BTC", "ETH", "SOL"]),
      spot: new Set(["PURR"]),
    });
    expect(result.newPerps).toEqual(["SOL"]);
    expect(result.newSpot).toEqual([]);
  });

  it("returns new spot symbols", () => {
    const result = diffSnapshot(known, {
      perps: new Set(["BTC", "ETH"]),
      spot: new Set(["PURR", "JEFF"]),
    });
    expect(result.newPerps).toEqual([]);
    expect(result.newSpot).toEqual(["JEFF"]);
  });

  it("ignores removals (assets no longer in universe)", () => {
    const result = diffSnapshot(known, { perps: new Set(["BTC"]), spot: new Set([]) });
    expect(result.newPerps).toEqual([]);
    expect(result.newSpot).toEqual([]);
  });
});

describe("diffDexSnapshot", () => {
  it("marks a dex as new on first sighting and returns its full symbol set", () => {
    const known: KnownAssets = { perps: {}, spot: {}, dexPerps: {}, lastPollAt: "t0" };
    const result = diffDexSnapshot(known, {
      dex: "xyz",
      fullName: "XYZ",
      perps: new Set(["xyz:SPCX", "xyz:TSLA"]),
      leverage: {},
    });
    expect(result.isNewDex).toBe(true);
    expect(result.newPerps.sort()).toEqual(["xyz:SPCX", "xyz:TSLA"]);
  });

  it("returns empty when known dex has not changed", () => {
    const known: KnownAssets = {
      perps: {},
      spot: {},
      dexPerps: {
        xyz: {
          fullName: "XYZ",
          firstSeen: "t0",
          assets: { "xyz:SPCX": { firstSeen: "t0" } },
        },
      },
      lastPollAt: "t0",
    };
    const result = diffDexSnapshot(known, {
      dex: "xyz",
      fullName: "XYZ",
      perps: new Set(["xyz:SPCX"]),
      leverage: {},
    });
    expect(result.isNewDex).toBe(false);
    expect(result.newPerps).toEqual([]);
  });

  it("returns only the new symbols inside a known dex", () => {
    const known: KnownAssets = {
      perps: {},
      spot: {},
      dexPerps: {
        xyz: {
          fullName: "XYZ",
          firstSeen: "t0",
          assets: { "xyz:SPCX": { firstSeen: "t0" } },
        },
      },
      lastPollAt: "t0",
    };
    const result = diffDexSnapshot(known, {
      dex: "xyz",
      fullName: "XYZ",
      perps: new Set(["xyz:SPCX", "xyz:NEWCOIN"]),
      leverage: {},
    });
    expect(result.isNewDex).toBe(false);
    expect(result.newPerps).toEqual(["xyz:NEWCOIN"]);
  });
});

describe("baselineDex", () => {
  it("stamps every provided symbol with firstSeen=now", () => {
    const dex = baselineDex("xyz", "XYZ", ["xyz:A", "xyz:B"], "now");
    expect(dex).toEqual({
      fullName: "XYZ",
      firstSeen: "now",
      assets: {
        "xyz:A": { firstSeen: "now" },
        "xyz:B": { firstSeen: "now" },
      },
    });
  });
});
