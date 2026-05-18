# Hyperliquid New Listing Detector — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript Node.js service that polls Hyperliquid's `meta` and `spotMeta` endpoints every second, detects newly-listed perp and spot assets, and notifies the user via Telegram (plus optional macOS desktop sound).

**Architecture:** Three modules with one responsibility each — `Poller` (1Hz REST tick), `Detector` (diff against persisted state + enrich), `Notifier` (fan-out to Telegram + desktop sound). State persisted in `known-assets.json` written atomically. Designed so phase 2 can add a `Trader` consumer of the same `ListingEvent` stream without touching detection.

**Tech Stack:** Node.js 20+, TypeScript 5, `tsx` for dev mode, `vitest` for tests, native `fetch` for HL REST. No HL SDK (signing is phase 2 only). `dotenv` for env loading.

**Spec:** [docs/superpowers/specs/2026-05-18-hyperliquid-new-listing-detector-design.md](../specs/2026-05-18-hyperliquid-new-listing-detector-design.md)

---

## File structure

```
hl_newlisting/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .gitignore
├── .env.example
├── README.md
├── deploy/
│   └── hl-newlisting.service
├── src/
│   ├── index.ts              # entry point, wires modules
│   ├── config.ts             # env var loading + validation
│   ├── types.ts              # ListingEvent, AssetSnapshot, KnownAssets
│   ├── logger.ts             # one-line JSON structured logger
│   ├── state.ts              # known-assets.json atomic read/write + diff
│   ├── hl-client.ts          # HL REST client (fetch wrapper)
│   ├── detector.ts           # diff → enrich → emit ListingEvent
│   ├── poller.ts             # 1Hz tick driving the detector
│   ├── heartbeat.ts          # periodic status to Telegram
│   ├── notifier.ts           # fan-out interface
│   └── notifiers/
│       ├── telegram.ts       # Telegram Bot API adapter
│       └── desktop-sound.ts  # macOS `afplay` adapter
└── tests/
    ├── config.test.ts
    ├── logger.test.ts
    ├── state.test.ts
    ├── hl-client.test.ts
    ├── detector.test.ts
    └── heartbeat.test.ts
```

---

## Task 1: Project bootstrap

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `README.md`

- [ ] **Step 1: Initialize git**

```bash
cd /Users/alperzkn/Documents/dev/hl_newlisting
git init
git branch -M main
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
dist/
data/
.env
.env.local
*.log
.DS_Store
.vitest-cache/
```

- [ ] **Step 3: Create `package.json`**

```json
{
  "name": "hl-newlisting",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 4: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 5: Create `.env.example`**

```
# Required
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Optional
HL_API_URL=https://api.hyperliquid.xyz
POLL_INTERVAL_MS=1000
HEARTBEAT_INTERVAL_MIN=60
STATE_FILE_PATH=./data/known-assets.json
TELEGRAM_HEARTBEAT_CHAT_ID=
ENABLE_DESKTOP_SOUND=false
LOG_LEVEL=info
```

- [ ] **Step 6: Create a stub `README.md`**

```markdown
# hl-newlisting

Detects newly-listed Hyperliquid perp and spot assets and notifies you on Telegram.

See `docs/superpowers/specs/2026-05-18-hyperliquid-new-listing-detector-design.md` for design.

## Setup

1. `cp .env.example .env` and fill in `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
2. `npm install`
3. `npm run dev` for local development, or `npm run build && npm start` for production.

## Telegram bot setup

1. Open Telegram, message [@BotFather](https://t.me/BotFather), send `/newbot`, follow prompts. Save the token it gives you.
2. Send any message to your new bot.
3. Get your chat ID: open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser and find `chat.id` in the response.
```

- [ ] **Step 7: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` is populated, `package-lock.json` is created.

- [ ] **Step 8: Verify TypeScript compiles (empty src)**

```bash
mkdir -p src
echo "export {};" > src/index.ts
npm run typecheck
```

Expected: no output (success).

- [ ] **Step 9: Commit**

```bash
git add .gitignore package.json package-lock.json tsconfig.json .env.example README.md src/index.ts docs/
git commit -m "chore: bootstrap TypeScript project"
```

---

## Task 2: Vitest setup

**Files:**
- Create: `vitest.config.ts`, `tests/smoke.test.ts`

- [ ] **Step 1: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    clearMocks: true,
    restoreMocks: true,
  },
});
```

- [ ] **Step 2: Write a smoke test**

`tests/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: `1 passed`.

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts tests/smoke.test.ts
git commit -m "chore: add vitest"
```

---

## Task 3: Shared types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Create types module**

```ts
// src/types.ts

export type Market = "perp" | "spot";

export type ListingEvent = {
  symbol: string;
  market: Market;
  detectedAt: string; // ISO 8601
  maxLeverage?: number; // perps only
  midPrice?: number;
  tradingUrl: string;
};

export type AssetSnapshot = {
  perps: Set<string>;
  spot: Set<string>;
};

export type AssetMeta = {
  firstSeen: string; // ISO 8601
};

export type KnownAssets = {
  perps: Record<string, AssetMeta>;
  spot: Record<string, AssetMeta>;
  lastPollAt: string; // ISO 8601, in-memory hint only
};

export type Notifier = {
  notify(event: ListingEvent): Promise<void>;
};

export type HeartbeatStatus = {
  lastPollAt: string;
  perpsCount: number;
  spotCount: number;
};
```

- [ ] **Step 2: Verify typecheck**

```bash
npm run typecheck
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add shared types"
```

---

## Task 4: Config module (TDD)

**Files:**
- Create: `src/config.ts`, `tests/config.test.ts`

- [ ] **Step 1: Write failing test**

`tests/config.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  beforeEach(() => {
    // Clear vars the test needs control over
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    delete process.env.HL_API_URL;
    delete process.env.POLL_INTERVAL_MS;
    delete process.env.HEARTBEAT_INTERVAL_MIN;
    delete process.env.STATE_FILE_PATH;
    delete process.env.TELEGRAM_HEARTBEAT_CHAT_ID;
    delete process.env.ENABLE_DESKTOP_SOUND;
  });

  it("throws when required vars missing", () => {
    expect(() => loadConfig()).toThrow(/TELEGRAM_BOT_TOKEN/);
  });

  it("returns config with defaults when only required vars set", () => {
    process.env.TELEGRAM_BOT_TOKEN = "abc";
    process.env.TELEGRAM_CHAT_ID = "123";
    const cfg = loadConfig();
    expect(cfg.telegramBotToken).toBe("abc");
    expect(cfg.telegramChatId).toBe("123");
    expect(cfg.hlApiUrl).toBe("https://api.hyperliquid.xyz");
    expect(cfg.pollIntervalMs).toBe(1000);
    expect(cfg.heartbeatIntervalMin).toBe(60);
    expect(cfg.stateFilePath).toBe("./data/known-assets.json");
    expect(cfg.telegramHeartbeatChatId).toBe("123"); // defaults to main chat
    expect(cfg.enableDesktopSound).toBe(false);
  });

  it("parses numeric env vars", () => {
    process.env.TELEGRAM_BOT_TOKEN = "abc";
    process.env.TELEGRAM_CHAT_ID = "123";
    process.env.POLL_INTERVAL_MS = "500";
    process.env.HEARTBEAT_INTERVAL_MIN = "10";
    const cfg = loadConfig();
    expect(cfg.pollIntervalMs).toBe(500);
    expect(cfg.heartbeatIntervalMin).toBe(10);
  });

  it("parses ENABLE_DESKTOP_SOUND=true", () => {
    process.env.TELEGRAM_BOT_TOKEN = "abc";
    process.env.TELEGRAM_CHAT_ID = "123";
    process.env.ENABLE_DESKTOP_SOUND = "true";
    expect(loadConfig().enableDesktopSound).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/config.test.ts
```

Expected: FAIL (module `../src/config.js` not found).

- [ ] **Step 3: Implement `src/config.ts`**

```ts
// src/config.ts
import "dotenv/config";

export type Config = {
  telegramBotToken: string;
  telegramChatId: string;
  telegramHeartbeatChatId: string;
  hlApiUrl: string;
  pollIntervalMs: number;
  heartbeatIntervalMin: number;
  stateFilePath: string;
  enableDesktopSound: boolean;
};

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const parsed = Number(v);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number for ${name}: ${v}`);
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return v.toLowerCase() === "true";
}

export function loadConfig(): Config {
  const telegramBotToken = required("TELEGRAM_BOT_TOKEN");
  const telegramChatId = required("TELEGRAM_CHAT_ID");
  return {
    telegramBotToken,
    telegramChatId,
    telegramHeartbeatChatId: process.env.TELEGRAM_HEARTBEAT_CHAT_ID || telegramChatId,
    hlApiUrl: process.env.HL_API_URL || "https://api.hyperliquid.xyz",
    pollIntervalMs: num("POLL_INTERVAL_MS", 1000),
    heartbeatIntervalMin: num("HEARTBEAT_INTERVAL_MIN", 60),
    stateFilePath: process.env.STATE_FILE_PATH || "./data/known-assets.json",
    enableDesktopSound: bool("ENABLE_DESKTOP_SOUND", false),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/config.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: config loader with env var validation"
```

---

## Task 5: Logger (TDD)

**Files:**
- Create: `src/logger.ts`, `tests/logger.test.ts`

- [ ] **Step 1: Write failing test**

`tests/logger.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createLogger } from "../src/logger.js";

describe("createLogger", () => {
  it("writes one-line JSON to stdout", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const log = createLogger();
    log.info("hello", { foo: "bar" });
    expect(spy).toHaveBeenCalledOnce();
    const line = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(line.trim());
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("hello");
    expect(parsed.foo).toBe("bar");
    expect(typeof parsed.ts).toBe("string");
  });

  it("writes error level to stderr", () => {
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const log = createLogger();
    log.error("boom", { code: 1 });
    expect(out).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledOnce();
    const line = err.mock.calls[0][0] as string;
    expect(JSON.parse(line.trim()).level).toBe("error");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/logger.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/logger.ts`**

```ts
// src/logger.ts
type Level = "debug" | "info" | "warn" | "error";

export type Logger = {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
};

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }) + "\n";
  if (level === "error" || level === "warn") {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

export function createLogger(): Logger {
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/logger.test.ts
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/logger.ts tests/logger.test.ts
git commit -m "feat: structured JSON logger"
```

---

## Task 6: State module — read + cold start (TDD)

**Files:**
- Create: `src/state.ts`, `tests/state.test.ts`

- [ ] **Step 1: Write failing tests for read + cold start**

`tests/state.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/state.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement read + isColdStart in `src/state.ts`**

```ts
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
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test -- tests/state.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/state.ts tests/state.test.ts
git commit -m "feat(state): read + cold-start detection"
```

---

## Task 7: State module — atomic write (TDD)

**Files:**
- Modify: `tests/state.test.ts` (append)

- [ ] **Step 1: Append tests for atomic write**

Append to `tests/state.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify pass**

```bash
npm test -- tests/state.test.ts
```

Expected: 7 passed (4 prior + 3 new). Implementation from Task 6 already covers this.

- [ ] **Step 3: Commit**

```bash
git add tests/state.test.ts
git commit -m "test(state): atomic write coverage"
```

---

## Task 8: State diff — detect new symbols (TDD)

**Files:**
- Modify: `src/state.ts` (add `diffSnapshot`)
- Modify: `tests/state.test.ts` (append)

- [ ] **Step 1: Append failing tests**

Append to `tests/state.test.ts`:

```ts
import { diffSnapshot } from "../src/state.js";

describe("diffSnapshot", () => {
  const known: KnownAssets = {
    perps: { BTC: { firstSeen: "t0" }, ETH: { firstSeen: "t0" } },
    spot: { PURR: { firstSeen: "t0" } },
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/state.test.ts
```

Expected: FAIL (`diffSnapshot` not exported).

- [ ] **Step 3: Add `diffSnapshot` to `src/state.ts`**

Append to `src/state.ts`:

```ts
import type { AssetSnapshot } from "./types.js";

export type SnapshotDiff = {
  newPerps: string[];
  newSpot: string[];
};

export function diffSnapshot(known: KnownAssets, snapshot: AssetSnapshot): SnapshotDiff {
  const newPerps = [...snapshot.perps].filter((s) => !(s in known.perps));
  const newSpot = [...snapshot.spot].filter((s) => !(s in known.spot));
  return { newPerps, newSpot };
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test -- tests/state.test.ts
```

Expected: 11 passed.

- [ ] **Step 5: Commit**

```bash
git add src/state.ts tests/state.test.ts
git commit -m "feat(state): diffSnapshot detects new symbols"
```

---

## Task 9: HL REST client (TDD)

**Files:**
- Create: `src/hl-client.ts`, `tests/hl-client.test.ts`

The Hyperliquid info API is a single POST endpoint that takes `{ type: "meta" | "spotMeta" | "allMids" }`. This task wraps that with typed methods.

- [ ] **Step 1: Write failing tests**

`tests/hl-client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHlClient } from "../src/hl-client.js";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

describe("createHlClient", () => {
  it("fetchMeta POSTs the right body and returns universe symbol set", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ universe: [{ name: "BTC", maxLeverage: 50 }, { name: "ETH", maxLeverage: 25 }] }))
    );
    const client = createHlClient("https://api.test");
    const result = await client.fetchMeta();
    expect(fetchMock).toHaveBeenCalledWith("https://api.test/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "meta" }),
    });
    expect(result.symbols).toEqual(new Set(["BTC", "ETH"]));
    expect(result.leverage).toEqual({ BTC: 50, ETH: 25 });
  });

  it("fetchSpotMeta returns symbol set", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ universe: [{ name: "PURR/USDC" }, { name: "JEFF/USDC" }], tokens: [] }))
    );
    const client = createHlClient("https://api.test");
    const result = await client.fetchSpotMeta();
    expect(result.symbols).toEqual(new Set(["PURR/USDC", "JEFF/USDC"]));
  });

  it("fetchAllMids returns price map", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ BTC: "42000.5", ETH: "2500.0" })));
    const client = createHlClient("https://api.test");
    const mids = await client.fetchAllMids();
    expect(mids.BTC).toBe(42000.5);
    expect(mids.ETH).toBe(2500);
  });

  it("throws on non-OK response", async () => {
    fetchMock.mockResolvedValueOnce(new Response("server error", { status: 500 }));
    const client = createHlClient("https://api.test");
    await expect(client.fetchMeta()).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/hl-client.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/hl-client.ts`**

```ts
// src/hl-client.ts

export type MetaResult = {
  symbols: Set<string>;
  leverage: Record<string, number>;
};

export type SpotMetaResult = {
  symbols: Set<string>;
};

export type HlClient = {
  fetchMeta(): Promise<MetaResult>;
  fetchSpotMeta(): Promise<SpotMetaResult>;
  fetchAllMids(): Promise<Record<string, number>>;
};

type RawMeta = { universe: Array<{ name: string; maxLeverage?: number }> };
type RawSpotMeta = { universe: Array<{ name: string }> };

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(`${url}/info`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`HL API ${res.status}: ${await res.text().catch(() => "")}`);
  }
  return (await res.json()) as T;
}

export function createHlClient(baseUrl: string): HlClient {
  return {
    async fetchMeta() {
      const raw = await post<RawMeta>(baseUrl, { type: "meta" });
      const symbols = new Set<string>();
      const leverage: Record<string, number> = {};
      for (const a of raw.universe) {
        symbols.add(a.name);
        if (typeof a.maxLeverage === "number") leverage[a.name] = a.maxLeverage;
      }
      return { symbols, leverage };
    },
    async fetchSpotMeta() {
      const raw = await post<RawSpotMeta>(baseUrl, { type: "spotMeta" });
      return { symbols: new Set(raw.universe.map((a) => a.name)) };
    },
    async fetchAllMids() {
      const raw = await post<Record<string, string>>(baseUrl, { type: "allMids" });
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw)) {
        const n = Number(v);
        if (Number.isFinite(n)) out[k] = n;
      }
      return out;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test -- tests/hl-client.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/hl-client.ts tests/hl-client.test.ts
git commit -m "feat: HL REST client (meta, spotMeta, allMids)"
```

---

## Task 10: Detector — pure event-building (TDD)

**Files:**
- Create: `src/detector.ts`, `tests/detector.test.ts`

The Detector turns a `SnapshotDiff` + enrichment data into `ListingEvent`s. Pure function, easy to unit test.

- [ ] **Step 1: Write failing tests**

`tests/detector.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/detector.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/detector.ts`**

```ts
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
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test -- tests/detector.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/detector.ts tests/detector.test.ts
git commit -m "feat: detector builds ListingEvents from snapshot diff"
```

---

## Task 11: Telegram notifier

**Files:**
- Create: `src/notifiers/telegram.ts`, `tests/telegram.test.ts`

Uses Telegram Bot API `sendMessage`. No SDK — direct `fetch` POST.

- [ ] **Step 1: Write failing test**

`tests/telegram.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTelegramNotifier, formatListingMessage } from "../src/notifiers/telegram.js";
import type { ListingEvent } from "../src/types.js";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

describe("formatListingMessage", () => {
  it("includes leverage for perp", () => {
    const event: ListingEvent = {
      symbol: "SOL",
      market: "perp",
      detectedAt: "2026-05-18T12:00:00.000Z",
      maxLeverage: 20,
      midPrice: 150.25,
      tradingUrl: "https://app.hyperliquid.xyz/trade/SOL",
    };
    const msg = formatListingMessage(event);
    expect(msg).toContain("SOL");
    expect(msg).toContain("perp");
    expect(msg).toContain("20x");
    expect(msg).toContain("150.25");
    expect(msg).toContain("https://app.hyperliquid.xyz/trade/SOL");
  });

  it("omits leverage line for spot", () => {
    const event: ListingEvent = {
      symbol: "JEFF/USDC",
      market: "spot",
      detectedAt: "2026-05-18T12:00:00.000Z",
      tradingUrl: "https://app.hyperliquid.xyz/trade/JEFF/USDC",
    };
    const msg = formatListingMessage(event);
    expect(msg).not.toMatch(/\d+x/);
  });
});

describe("telegram notifier", () => {
  it("POSTs to sendMessage with the right body", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));
    const notifier = createTelegramNotifier({ token: "abc", chatId: "111" });
    await notifier.notify({
      symbol: "SOL",
      market: "perp",
      detectedAt: "2026-05-18T12:00:00.000Z",
      maxLeverage: 20,
      tradingUrl: "https://app.hyperliquid.xyz/trade/SOL",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/botabc/sendMessage");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.chat_id).toBe("111");
    expect(body.text).toContain("SOL");
    expect(body.disable_web_page_preview).toBe(true);
  });

  it("throws when telegram returns non-ok", async () => {
    fetchMock.mockResolvedValueOnce(new Response("err", { status: 400 }));
    const notifier = createTelegramNotifier({ token: "abc", chatId: "111" });
    await expect(
      notifier.notify({
        symbol: "X",
        market: "perp",
        detectedAt: "t",
        tradingUrl: "u",
      })
    ).rejects.toThrow(/400/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/telegram.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/notifiers/telegram.ts`**

```ts
// src/notifiers/telegram.ts
import type { ListingEvent, Notifier } from "../types.js";

export function formatListingMessage(event: ListingEvent): string {
  const lines: string[] = [];
  lines.push("🚨 New Hyperliquid listing");
  lines.push("");
  lines.push(`Symbol: ${event.symbol}`);
  if (event.market === "perp") {
    const lev = event.maxLeverage !== undefined ? ` (${event.maxLeverage}x max)` : "";
    lines.push(`Market: perp${lev}`);
  } else {
    lines.push(`Market: spot`);
  }
  if (event.midPrice !== undefined) lines.push(`Mid:    $${event.midPrice}`);
  lines.push(`Time:   ${event.detectedAt}`);
  lines.push("");
  lines.push(event.tradingUrl);
  return lines.join("\n");
}

export type TelegramOpts = { token: string; chatId: string };

export function createTelegramNotifier(opts: TelegramOpts): Notifier {
  return {
    async notify(event: ListingEvent) {
      const res = await fetch(`https://api.telegram.org/bot${opts.token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: opts.chatId,
          text: formatListingMessage(event),
          disable_web_page_preview: true,
        }),
      });
      if (!res.ok) {
        throw new Error(`Telegram sendMessage ${res.status}: ${await res.text().catch(() => "")}`);
      }
    },
  };
}

export async function sendTelegramText(token: string, chatId: string, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  if (!res.ok) {
    throw new Error(`Telegram sendMessage ${res.status}: ${await res.text().catch(() => "")}`);
  }
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
npm test -- tests/telegram.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/notifiers/telegram.ts tests/telegram.test.ts
git commit -m "feat: Telegram notifier"
```

---

## Task 12: Desktop sound notifier

**Files:**
- Create: `src/notifiers/desktop-sound.ts`

Spawns `afplay` on macOS. No tests — pure side effect, manual verification only.

- [ ] **Step 1: Implement `src/notifiers/desktop-sound.ts`**

```ts
// src/notifiers/desktop-sound.ts
import { spawn } from "node:child_process";
import type { Notifier } from "../types.js";

const SOUND_FILE = "/System/Library/Sounds/Glass.aiff";

export function createDesktopSoundNotifier(): Notifier {
  return {
    async notify() {
      try {
        spawn("afplay", [SOUND_FILE], { detached: true, stdio: "ignore" }).unref();
      } catch {
        // best-effort
      }
    },
  };
}
```

- [ ] **Step 2: Manual verification (local Mac only)**

```bash
node -e 'import("./src/notifiers/desktop-sound.ts").then(m => m.createDesktopSoundNotifier().notify({}))'
```

Note: this requires `tsx` to actually load TS. Easier: skip manual test, it'll get verified in the smoke test (Task 17).

- [ ] **Step 3: Commit**

```bash
git add src/notifiers/desktop-sound.ts
git commit -m "feat: desktop sound notifier (macOS afplay)"
```

---

## Task 13: Notifier fan-out (TDD)

**Files:**
- Create: `src/notifier.ts`, `tests/notifier-fanout.test.ts`

Wraps multiple `Notifier`s, calls them in parallel, swallows individual errors (logs them) so one failure doesn't break the others.

- [ ] **Step 1: Write failing test**

`tests/notifier-fanout.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createFanoutNotifier } from "../src/notifier.js";
import type { Notifier, ListingEvent } from "../src/types.js";

const event: ListingEvent = {
  symbol: "X",
  market: "perp",
  detectedAt: "t",
  tradingUrl: "u",
};

describe("createFanoutNotifier", () => {
  it("calls every child notifier", async () => {
    const a: Notifier = { notify: vi.fn().mockResolvedValue(undefined) };
    const b: Notifier = { notify: vi.fn().mockResolvedValue(undefined) };
    const fanout = createFanoutNotifier([a, b], { onError: () => {} });
    await fanout.notify(event);
    expect(a.notify).toHaveBeenCalledWith(event);
    expect(b.notify).toHaveBeenCalledWith(event);
  });

  it("does not throw when one notifier fails — calls onError", async () => {
    const a: Notifier = { notify: vi.fn().mockRejectedValue(new Error("boom")) };
    const b: Notifier = { notify: vi.fn().mockResolvedValue(undefined) };
    const onError = vi.fn();
    const fanout = createFanoutNotifier([a, b], { onError });
    await fanout.notify(event);
    expect(b.notify).toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), event);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/notifier-fanout.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/notifier.ts`**

```ts
// src/notifier.ts
import type { ListingEvent, Notifier } from "./types.js";

export type FanoutOpts = {
  onError: (err: unknown, event: ListingEvent) => void;
};

export function createFanoutNotifier(children: Notifier[], opts: FanoutOpts): Notifier {
  return {
    async notify(event: ListingEvent) {
      await Promise.all(
        children.map((c) => c.notify(event).catch((err) => opts.onError(err, event)))
      );
    },
  };
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
npm test -- tests/notifier-fanout.test.ts
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/notifier.ts tests/notifier-fanout.test.ts
git commit -m "feat: notifier fan-out with error isolation"
```

---

## Task 14: Heartbeat (TDD with fake timers)

**Files:**
- Create: `src/heartbeat.ts`, `tests/heartbeat.test.ts`

Heartbeat fires every N minutes unless a real listing fires in that window (which resets the timer).

- [ ] **Step 1: Write failing tests**

`tests/heartbeat.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHeartbeat } from "../src/heartbeat.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("heartbeat", () => {
  it("calls send() after the interval elapses", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const status = vi.fn().mockReturnValue({ lastPollAt: "t", perpsCount: 5, spotCount: 3 });
    const hb = createHeartbeat({ intervalMs: 60_000, send, status });
    hb.start();
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(expect.stringContaining("5 perps"));
    hb.stop();
  });

  it("reset() restarts the timer", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const status = vi.fn().mockReturnValue({ lastPollAt: "t", perpsCount: 0, spotCount: 0 });
    const hb = createHeartbeat({ intervalMs: 60_000, send, status });
    hb.start();
    await vi.advanceTimersByTimeAsync(30_000);
    hb.reset();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(send).toHaveBeenCalledOnce();
    hb.stop();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/heartbeat.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/heartbeat.ts`**

```ts
// src/heartbeat.ts
import type { HeartbeatStatus } from "./types.js";

export type HeartbeatOpts = {
  intervalMs: number;
  send: (text: string) => Promise<void>;
  status: () => HeartbeatStatus;
};

export type Heartbeat = {
  start(): void;
  stop(): void;
  reset(): void;
};

export function createHeartbeat(opts: HeartbeatOpts): Heartbeat {
  let timer: NodeJS.Timeout | null = null;

  const schedule = () => {
    timer = setTimeout(async () => {
      const s = opts.status();
      const text = `still alive — last poll ${s.lastPollAt} — tracking ${s.perpsCount} perps + ${s.spotCount} spot`;
      try {
        await opts.send(text);
      } catch {
        // swallow; heartbeat failure isn't critical
      }
      schedule();
    }, opts.intervalMs);
  };

  return {
    start: () => {
      if (!timer) schedule();
    },
    stop: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    reset: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      schedule();
    },
  };
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
npm test -- tests/heartbeat.test.ts
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/heartbeat.ts tests/heartbeat.test.ts
git commit -m "feat: heartbeat timer with reset"
```

---

## Task 15: Poller — single-tick orchestration

**Files:**
- Create: `src/poller.ts`

The Poller is the glue: every tick, fetch snapshots, diff against state, enrich, notify, persist. We expose a `runTick()` function for testability and a `start()` that wraps it in `setInterval`.

- [ ] **Step 1: Implement `src/poller.ts`**

```ts
// src/poller.ts
import type { HlClient } from "./hl-client.js";
import type { AssetSnapshot, KnownAssets, ListingEvent, Notifier } from "./types.js";
import type { Logger } from "./logger.js";
import { diffSnapshot, isColdStart, readState, writeState } from "./state.js";
import { buildListingEvents } from "./detector.js";

export type PollerDeps = {
  client: HlClient;
  notifier: Notifier;
  logger: Logger;
  stateFilePath: string;
  onListing?: (event: ListingEvent) => void; // for heartbeat reset
  getSnapshotForStatus?: () => { perpsCount: number; spotCount: number };
};

export type Poller = {
  runTick(): Promise<void>;
  start(intervalMs: number): void;
  stop(): void;
  getStatus(): { lastPollAt: string; perpsCount: number; spotCount: number };
};

export function createPoller(deps: PollerDeps): Poller {
  let known: KnownAssets | null = null;
  let lastPollAt = new Date(0).toISOString();
  let interval: NodeJS.Timeout | null = null;

  async function loadOrBaseline(snapshot: AssetSnapshot, leverage: Record<string, number>) {
    if (await isColdStart(deps.stateFilePath)) {
      const now = new Date().toISOString();
      known = {
        perps: Object.fromEntries([...snapshot.perps].map((s) => [s, { firstSeen: now }])),
        spot: Object.fromEntries([...snapshot.spot].map((s) => [s, { firstSeen: now }])),
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
        // file existed at isColdStart check but read failed — treat as cold start
        known = { perps: {}, spot: {}, lastPollAt: new Date().toISOString() };
        await writeState(deps.stateFilePath, known);
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

      if (!known) {
        await loadOrBaseline(snapshot, meta.leverage);
        return;
      }

      const diff = diffSnapshot(known, snapshot);
      if (diff.newPerps.length === 0 && diff.newSpot.length === 0) return;

      // Fetch mids only when needed
      const mids = await deps.client.fetchAllMids().catch((err) => {
        deps.logger.warn("allMids fetch failed; proceeding without mids", { err: String(err) });
        return {} as Record<string, number>;
      });

      const events = buildListingEvents(diff, {
        now: lastPollAt,
        leverage: meta.leverage,
        mids,
      });

      // Persist BEFORE notifying so a crash mid-notify won't cause re-fire.
      for (const s of diff.newPerps) known.perps[s] = { firstSeen: lastPollAt };
      for (const s of diff.newSpot) known.spot[s] = { firstSeen: lastPollAt };
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
    } catch (err) {
      deps.logger.warn("tick failed", { err: String(err) });
    }
  }

  return {
    runTick,
    start(intervalMs: number) {
      if (interval) return;
      interval = setInterval(() => void runTick(), intervalMs);
      void runTick(); // fire one immediately on start
    },
    stop() {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    },
    getStatus() {
      return {
        lastPollAt,
        perpsCount: known ? Object.keys(known.perps).length : 0,
        spotCount: known ? Object.keys(known.spot).length : 0,
      };
    },
  };
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/poller.ts
git commit -m "feat: poller orchestrates tick loop"
```

---

## Task 16: Entry point — wire everything together

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Rewrite `src/index.ts`**

```ts
// src/index.ts
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createHlClient } from "./hl-client.js";
import { createPoller } from "./poller.js";
import { createFanoutNotifier } from "./notifier.js";
import { createTelegramNotifier, sendTelegramText } from "./notifiers/telegram.js";
import { createDesktopSoundNotifier } from "./notifiers/desktop-sound.js";
import { createHeartbeat } from "./heartbeat.js";

async function main() {
  const cfg = loadConfig();
  const logger = createLogger();
  const client = createHlClient(cfg.hlApiUrl);

  const notifiers = [
    createTelegramNotifier({ token: cfg.telegramBotToken, chatId: cfg.telegramChatId }),
  ];
  if (cfg.enableDesktopSound) notifiers.push(createDesktopSoundNotifier());

  const notifier = createFanoutNotifier(notifiers, {
    onError: (err, event) => {
      // Log the full event so a missed notification can be recovered by grepping the journal.
      logger.error("notifier failed", { err: String(err), event });
    },
  });

  let getStatus: () => { lastPollAt: string; perpsCount: number; spotCount: number } = () => ({
    lastPollAt: new Date().toISOString(),
    perpsCount: 0,
    spotCount: 0,
  });

  const heartbeat = createHeartbeat({
    intervalMs: cfg.heartbeatIntervalMin * 60_000,
    send: (text) => sendTelegramText(cfg.telegramBotToken, cfg.telegramHeartbeatChatId, text),
    status: () => getStatus(),
  });

  const poller = createPoller({
    client,
    notifier,
    logger,
    stateFilePath: cfg.stateFilePath,
    onListing: () => heartbeat.reset(),
  });
  getStatus = () => poller.getStatus();

  process.on("uncaughtException", (err) => {
    logger.error("uncaughtException", { err: String(err) });
    process.exit(1);
  });
  process.on("unhandledRejection", (err) => {
    logger.error("unhandledRejection", { err: String(err) });
    process.exit(1);
  });

  const shutdown = (signal: string) => {
    logger.info("shutting down", { signal });
    poller.stop();
    heartbeat.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  logger.info("starting hl-newlisting", {
    pollIntervalMs: cfg.pollIntervalMs,
    heartbeatIntervalMin: cfg.heartbeatIntervalMin,
    desktopSound: cfg.enableDesktopSound,
  });

  poller.start(cfg.pollIntervalMs);
  heartbeat.start();
}

main().catch((err) => {
  process.stderr.write(JSON.stringify({ level: "error", msg: "fatal at startup", err: String(err) }) + "\n");
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: `dist/` populated with compiled JS, no errors.

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: all tests pass (config, logger, state, hl-client, detector, telegram, notifier-fanout, heartbeat, smoke).

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire entry point"
```

---

## Task 17: Local smoke test against live HL API

**Files:**
- None modified. Manual verification only.

- [ ] **Step 1: Prepare `.env`**

```bash
cp .env.example .env
```

Edit `.env` and set:
- `TELEGRAM_BOT_TOKEN` — from @BotFather (see README).
- `TELEGRAM_CHAT_ID` — your chat ID with the bot.
- `ENABLE_DESKTOP_SOUND=true`
- `HEARTBEAT_INTERVAL_MIN=2` (so we can see a heartbeat fast)

- [ ] **Step 2: Run in dev mode**

```bash
rm -rf data/
npm run dev
```

Expected behavior:
- First log line: `"starting hl-newlisting"`.
- Within ~1s: `"cold start: baseline written"` with a count of perps and spot.
- Steady state: no per-tick log spam (only failures or new listings logged).
- After 2 minutes: a Telegram message: "still alive — last poll ... — tracking N perps + M spot".

- [ ] **Step 3: Simulate a new listing**

While the process is running, in another terminal:

```bash
# Remove one perp from state to fake a "new listing" on next tick
node -e '
const fs=require("fs");
const p="./data/known-assets.json";
const s=JSON.parse(fs.readFileSync(p,"utf8"));
const victim=Object.keys(s.perps)[0];
console.log("removing",victim);
delete s.perps[victim];
fs.writeFileSync(p,JSON.stringify(s,null,2));
'
```

Expected within 1 second:
- Log line: `"new listing"` with the symbol.
- Telegram message arrives in your chat.
- Desktop sound (Glass.aiff) plays.

- [ ] **Step 4: Stop with Ctrl+C**

Expected: clean shutdown log line.

- [ ] **Step 5: Commit any `.env` template tweaks if needed**

```bash
# Only if you changed .env.example — never commit .env itself.
git status
# If .env.example changed:
git add .env.example
git commit -m "chore: tweak env template"
```

---

## Task 18: Deployment artifacts

**Files:**
- Create: `deploy/hl-newlisting.service`
- Modify: `README.md` (append deployment section)

- [ ] **Step 1: Create systemd unit**

`deploy/hl-newlisting.service`:

```ini
[Unit]
Description=Hyperliquid new-listing detector
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=hl-newlisting
Group=hl-newlisting
WorkingDirectory=/opt/hl-newlisting
EnvironmentFile=/etc/hl-newlisting.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5s
StandardOutput=journal
StandardError=journal
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/hl-newlisting

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Append deployment section to `README.md`**

Append to `README.md`:

```markdown

## Deployment to DigitalOcean droplet

Prereqs on the droplet: Node 20+, git.

```bash
# As root, one-time setup
sudo useradd --system --shell /usr/sbin/nologin --home /opt/hl-newlisting hl-newlisting
sudo mkdir -p /opt/hl-newlisting /var/lib/hl-newlisting
sudo chown hl-newlisting:hl-newlisting /var/lib/hl-newlisting

# Deploy the code (run as your normal user)
sudo git clone <repo-url> /opt/hl-newlisting
cd /opt/hl-newlisting
sudo npm ci --omit=dev
sudo npm run build
sudo chown -R hl-newlisting:hl-newlisting /opt/hl-newlisting

# Env file (don't commit; create on the server)
sudo tee /etc/hl-newlisting.env > /dev/null <<'EOF'
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
STATE_FILE_PATH=/var/lib/hl-newlisting/known-assets.json
ENABLE_DESKTOP_SOUND=false
HEARTBEAT_INTERVAL_MIN=60
EOF
sudo chmod 0600 /etc/hl-newlisting.env

# Install + start the service
sudo cp deploy/hl-newlisting.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hl-newlisting

# Verify
sudo systemctl status hl-newlisting
sudo journalctl -u hl-newlisting -f
```

To update: `git pull`, `npm ci --omit=dev`, `npm run build`, `sudo systemctl restart hl-newlisting`.
```

- [ ] **Step 3: Commit**

```bash
git add deploy/hl-newlisting.service README.md
git commit -m "chore: systemd unit + deployment docs"
```

- [ ] **Step 4: Final verification**

```bash
npm run typecheck && npm test && npm run build
```

Expected: all three commands succeed with no errors.

---

## Done

After Task 18, you have a working phase 1: detector + notifications, locally and deployable to your droplet. Phase 2 will plug a `Trader` module into the notifier fan-out — the detection path stays untouched.
