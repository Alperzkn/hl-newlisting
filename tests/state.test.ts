import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { readState, writeState, isColdStart } from "../src/state.js";
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
      lastPollAt: "2024-01-01T00:00:00.000Z",
    };
    await fs.writeFile(stateFile, JSON.stringify(data));
    const loaded = await readState(stateFile);
    expect(loaded).toEqual(data);
  });
});

describe("writeState", () => {
  it("creates the state file with correct content", async () => {
    const data: KnownAssets = {
      perps: { ETH: { firstSeen: "2024-02-01T00:00:00.000Z" } },
      spot: { PURR: { firstSeen: "2024-02-01T00:00:00.000Z" } },
      lastPollAt: "2024-02-01T00:00:00.000Z",
    };
    await writeState(stateFile, data);
    const roundTripped = await readState(stateFile);
    expect(roundTripped).toEqual(data);
  });

  it("creates parent directories if missing", async () => {
    const nested = path.join(tmpDir, "a", "b", "c", "state.json");
    const data: KnownAssets = { perps: {}, spot: {}, lastPollAt: "x" };
    await writeState(nested, data);
    expect(await readState(nested)).toEqual(data);
  });

  it("does not leave a .tmp file behind on success", async () => {
    const data: KnownAssets = { perps: {}, spot: {}, lastPollAt: "x" };
    await writeState(stateFile, data);
    const entries = await fs.readdir(tmpDir);
    expect(entries).toContain(path.basename(stateFile));
    expect(entries).not.toContain(`${path.basename(stateFile)}.tmp`);
  });
});
