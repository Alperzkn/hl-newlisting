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
