// src/state.ts
import { promises as fs } from "node:fs";
import path from "node:path";
import type { KnownAssets } from "./types.js";

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
    return JSON.parse(buf) as KnownAssets;
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
