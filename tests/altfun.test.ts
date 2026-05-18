import { describe, it, expect, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createAltfunWatcher,
  decodeAbiString,
  pairCreatedTopic,
  topicToAddress,
} from "../src/watchers/altfun.js";
import type { Logger } from "../src/logger.js";
import type { Notifier } from "../src/types.js";

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const FACTORY = "0x4df039804873717bff7d03694fb941cf0469b79e";
const PAIR_TOPIC = pairCreatedTopic();

function makeLog(token0: string, token1: string, pair: string, block = 100): {
  topics: string[];
  data: string;
  transactionHash: string;
  blockNumber: string;
} {
  const pad = (addr: string) =>
    "0x" + addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const data = "0x" + pair.toLowerCase().replace(/^0x/, "").padStart(64, "0") + "00".repeat(32);
  return {
    topics: [PAIR_TOPIC, pad(token0), pad(token1)],
    data,
    transactionHash: "0xabc",
    blockNumber: "0x" + block.toString(16),
  };
}

function makeRpcResponses(...steps: Array<{ method: string; result: unknown }>): typeof fetch {
  let idx = 0;
  return (async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (idx >= steps.length) {
      throw new Error(`unexpected extra RPC call: ${body.method}`);
    }
    const step = steps[idx++];
    if (step.method !== body.method) {
      throw new Error(`expected ${step.method} got ${body.method} at step ${idx - 1}`);
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: step.result }), {
      status: 200,
    });
  }) as unknown as typeof fetch;
}

describe("topicToAddress", () => {
  it("extracts the last 20 bytes as a checksummed lowercase address", () => {
    const topic = "0x000000000000000000000000abcdef0123456789abcdef0123456789abcdef01";
    expect(topicToAddress(topic)).toBe("0xabcdef0123456789abcdef0123456789abcdef01");
  });
});

describe("decodeAbiString", () => {
  it("decodes a standard ABI string return", () => {
    // offset=0x20, length=5, data="STONK" padded to 32 bytes
    const hex =
      "0x" +
      "0000000000000000000000000000000000000000000000000000000000000020" +
      "0000000000000000000000000000000000000000000000000000000000000005" +
      "53544f4e4b" +
      "00".repeat(27);
    expect(decodeAbiString(hex)).toBe("STONK");
  });

  it("decodes bytes32 fallback when no offset/length structure", () => {
    const hex = "0x" + "53504358".padEnd(64, "0"); // "SPCX" + zeros
    expect(decodeAbiString(hex)).toBe("SPCX");
  });

  it("returns null for empty or 0x-only responses", () => {
    expect(decodeAbiString("0x")).toBeNull();
    expect(decodeAbiString("")).toBeNull();
  });
});

describe("createAltfunWatcher cold start", () => {
  it("writes lastBlock and emits no listing on first sweep", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "altfun-"));
    const stateFile = path.join(tmpDir, "altfun-state.json");

    const fetchImpl = makeRpcResponses({ method: "eth_blockNumber", result: "0x3e8" });
    const notifier: Notifier = { notify: vi.fn().mockResolvedValue(undefined) };

    const watcher = createAltfunWatcher({
      rpcUrl: "https://rpc.test",
      factoryAddress: FACTORY,
      pollIntervalMs: 60_000,
      stateFilePath: stateFile,
      label: "alt.fun",
      tradingUrlTemplate: "https://example.test/{token}",
      logger: silentLogger,
      notifier,
      fetchImpl,
    });

    await watcher.runOnce();
    expect(notifier.notify).not.toHaveBeenCalled();
    expect(watcher.getLastBlock()).toBe(1000);

    const persisted = JSON.parse(await fs.readFile(stateFile, "utf8"));
    expect(persisted.lastBlock).toBe(1000);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});

describe("createAltfunWatcher sweep", () => {
  it("notifies a new pair and resolves token symbol via eth_call", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "altfun-"));
    const stateFile = path.join(tmpDir, "altfun-state.json");
    // Pre-seed lastBlock to skip the cold-start branch.
    await fs.writeFile(stateFile, JSON.stringify({ lastBlock: 100, lastSweepAt: "t0" }));

    const newToken = "0xabcdef0123456789abcdef0123456789abcdef01";
    const quote = "0x1111111111111111111111111111111111111111";
    const pair = "0x2222222222222222222222222222222222222222";
    const symbolHex =
      "0x" +
      "0000000000000000000000000000000000000000000000000000000000000020" +
      "0000000000000000000000000000000000000000000000000000000000000005" +
      "53544f4e4b" +
      "00".repeat(27);
    const nameHex =
      "0x" +
      "0000000000000000000000000000000000000000000000000000000000000020" +
      "0000000000000000000000000000000000000000000000000000000000000006" +
      "53746f6e6b73" +
      "00".repeat(26);

    const fetchImpl = makeRpcResponses(
      { method: "eth_blockNumber", result: "0x96" }, // 150
      { method: "eth_getLogs", result: [makeLog(newToken, quote, pair, 130)] },
      { method: "eth_call", result: symbolHex }, // symbol()
      { method: "eth_call", result: nameHex } //   name()
    );

    const notifyMock = vi.fn().mockResolvedValue(undefined);
    const notifier: Notifier = { notify: notifyMock };

    const watcher = createAltfunWatcher({
      rpcUrl: "https://rpc.test",
      factoryAddress: FACTORY,
      quoteTokenAddress: quote,
      pollIntervalMs: 60_000,
      stateFilePath: stateFile,
      label: "alt.fun",
      tradingUrlTemplate: "https://example.test/{token}",
      logger: silentLogger,
      notifier,
      fetchImpl,
    });

    await watcher.runOnce();
    expect(notifyMock).toHaveBeenCalledOnce();
    const event = notifyMock.mock.calls[0][0];
    expect(event.symbol).toBe("STONK");
    expect(event.market).toBe("spot");
    expect(event.dex).toBe("alt.fun");
    expect(event.tradingUrl).toBe(`https://example.test/${newToken}`);
    expect(watcher.getLastBlock()).toBe(150);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("filters out pairs that don't match the configured quote token", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "altfun-"));
    const stateFile = path.join(tmpDir, "altfun-state.json");
    await fs.writeFile(stateFile, JSON.stringify({ lastBlock: 100, lastSweepAt: "t0" }));

    const quote = "0x1111111111111111111111111111111111111111";
    const tokenA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const tokenB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const pair = "0xcccccccccccccccccccccccccccccccccccccccc";

    const fetchImpl = makeRpcResponses(
      { method: "eth_blockNumber", result: "0x96" },
      { method: "eth_getLogs", result: [makeLog(tokenA, tokenB, pair, 130)] }
      // No eth_call expected since pair is filtered out.
    );

    const notifyMock = vi.fn().mockResolvedValue(undefined);
    const watcher = createAltfunWatcher({
      rpcUrl: "https://rpc.test",
      factoryAddress: FACTORY,
      quoteTokenAddress: quote,
      pollIntervalMs: 60_000,
      stateFilePath: stateFile,
      label: "alt.fun",
      tradingUrlTemplate: "https://example.test/{token}",
      logger: silentLogger,
      notifier: { notify: notifyMock },
      fetchImpl,
    });

    await watcher.runOnce();
    expect(notifyMock).not.toHaveBeenCalled();
    expect(watcher.getLastBlock()).toBe(150);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
