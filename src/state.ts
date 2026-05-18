// src/state.ts
import { promises as fs } from "node:fs";
import path from "node:path";
import type { AssetSnapshot, DexInfo, DexSnapshot, KnownAssets } from "./types.js";

export type SnapshotDiff = {
  newPerps: string[];
  newSpot: string[];
};

export type DexDiff = {
  dex: string;
  fullName: string;
  newPerps: string[];
  isNewDex: boolean;
};

export async function isColdStart(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return false;
  } catch {
    return true;
  }
}

export async function readState(filePath: string): Promise<KnownAssets | null> {
  try {
    const buf = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(buf) as Partial<KnownAssets>;
    // Migrate older state files that predate dexPerps.
    return {
      perps: parsed.perps ?? {},
      spot: parsed.spot ?? {},
      dexPerps: parsed.dexPerps ?? {},
      lastPollAt: parsed.lastPollAt ?? new Date().toISOString(),
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeState(filePath: string, state: KnownAssets): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2));
  await fs.rename(tmp, filePath);
}

export function diffSnapshot(known: KnownAssets, snapshot: AssetSnapshot): SnapshotDiff {
  const newPerps = [...snapshot.perps].filter((s) => !(s in known.perps));
  const newSpot = [...snapshot.spot].filter((s) => !(s in known.spot));
  return { newPerps, newSpot };
}

export function diffDexSnapshot(known: KnownAssets, snapshot: DexSnapshot): DexDiff {
  const existing = known.dexPerps[snapshot.dex];
  if (!existing) {
    return {
      dex: snapshot.dex,
      fullName: snapshot.fullName,
      newPerps: [...snapshot.perps],
      isNewDex: true,
    };
  }
  const newPerps = [...snapshot.perps].filter((s) => !(s in existing.assets));
  return {
    dex: snapshot.dex,
    fullName: snapshot.fullName,
    newPerps,
    isNewDex: false,
  };
}

export function baselineDex(dexName: string, fullName: string, symbols: Iterable<string>, now: string): DexInfo {
  const assets: Record<string, { firstSeen: string }> = {};
  for (const s of symbols) assets[s] = { firstSeen: now };
  return { fullName, firstSeen: now, assets };
}
