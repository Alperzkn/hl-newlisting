import { describe, it, expect, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createAltfunWatcher,
  decodeAbiString,
  tokenGraduatedTopic,
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

const BONDING = "0xb68811BcC0e4FcD825aA49F9453b065ddF752FcB";
const GRADUATED_TOPIC = tokenGraduatedTopic();

const pad = (addr: string) => "0x" + addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");

function makeGraduatedLog(token: string, pair: string, block = 130): {
  topics: string[];
  data: string;
  transactionHash: string;
  blockNumber: string;
} {
  return {
    // TokenGraduated(address indexed token, address indexed pairAddress, ...4 uint256)
    topics: [GRADUATED_TOPIC, pad(token), pad(pair)],
    data: "0x" + "00".repeat(32 * 4),
    transactionHash: "0xgrad",
    blockNumber: "0x" + block.toString(16),
  };
}

function makeRpcResponses(...steps: Array<{ method: string; result: unknown }>): typeof fetch {
  let idx = 0;
  return (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (idx >= steps.length) throw new Error(`unexpected extra RPC call: ${body.method}`);
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
  it("extracts the last 20 bytes as a lowercase address", () => {
    const topic = "0x000000000000000000000000abcdef0123456789abcdef0123456789abcdef01";
    expect(topicToAddress(topic)).toBe("0xabcdef0123456789abcdef0123456789abcdef01");
  });
});

describe("decodeAbiString", () => {
  it("decodes a standard ABI string return", () => {
    const hex =
      "0x" +
      "0000000000000000000000000000000000000000000000000000000000000020" +
      "0000000000000000000000000000000000000000000000000000000000000005" +
      "53544f4e4b" +
      "00".repeat(27);
    expect(decodeAbiString(hex)).toBe("STONK");
  });

  it("decodes bytes32 fallback when no offset/length structure", () => {
    const hex = "0x" + "53504358".padEnd(64, "0");
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
      bondingContract: BONDING,
      pollIntervalMs: 60_000,
      stateFilePath: stateFile,
      label: "alt.fun",
      tradingUrlTemplate: "https://alt.fun/coin/{token}",
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

describe("createAltfunWatcher graduation sweep", () => {
  it("notifies on a TokenGraduated event, resolving symbol and pair", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "altfun-"));
    const stateFile = path.join(tmpDir, "altfun-state.json");
    await fs.writeFile(stateFile, JSON.stringify({ lastBlock: 100, lastSweepAt: "t0" }));

    const token = "0x1e20f45f0582ee5c0530245fed4426cd00000000"; // AURA-like
    const pair = "0x8a7b6dc7a15842d3d50185ee3fc38e59110ee915";
    const symHex =
      "0x" +
      "0000000000000000000000000000000000000000000000000000000000000020" +
      "0000000000000000000000000000000000000000000000000000000000000004" +
      "41555241" + // "AURA"
      "00".repeat(28);
    const nameHex =
      "0x" +
      "0000000000000000000000000000000000000000000000000000000000000020" +
      "0000000000000000000000000000000000000000000000000000000000000004" +
      "41555241" +
      "00".repeat(28);

    const fetchImpl = makeRpcResponses(
      { method: "eth_blockNumber", result: "0x96" }, // 150
      { method: "eth_getLogs", result: [makeGraduatedLog(token, pair, 130)] },
      { method: "eth_call", result: symHex }, // symbol()
      { method: "eth_call", result: nameHex } // name()
    );

    const notifyMock = vi.fn().mockResolvedValue(undefined);
    const watcher = createAltfunWatcher({
      rpcUrl: "https://rpc.test",
      bondingContract: BONDING,
      pollIntervalMs: 60_000,
      stateFilePath: stateFile,
      label: "alt.fun",
      tradingUrlTemplate: "https://alt.fun/coin/{token}",
      logger: silentLogger,
      notifier: { notify: notifyMock },
      fetchImpl,
    });

    await watcher.runOnce();
    expect(notifyMock).toHaveBeenCalledOnce();
    const event = notifyMock.mock.calls[0][0];
    expect(event.symbol).toBe("AURA");
    expect(event.market).toBe("spot");
    expect(event.dex).toBe("alt.fun");
    expect(event.tradingUrl).toBe(`https://alt.fun/coin/${token}`);
    expect(watcher.getLastBlock()).toBe(150);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("falls back to the token address when symbol() and name() are undecodable", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "altfun-"));
    const stateFile = path.join(tmpDir, "altfun-state.json");
    await fs.writeFile(stateFile, JSON.stringify({ lastBlock: 100, lastSweepAt: "t0" }));

    const token = "0xabc1230000000000000000000000000000000000";
    const pair = "0xdef4560000000000000000000000000000000000";

    const fetchImpl = makeRpcResponses(
      { method: "eth_blockNumber", result: "0x96" },
      { method: "eth_getLogs", result: [makeGraduatedLog(token, pair, 130)] },
      { method: "eth_call", result: "0x" }, // symbol() empty
      { method: "eth_call", result: "0x" } //  name() empty
    );

    const notifyMock = vi.fn().mockResolvedValue(undefined);
    const watcher = createAltfunWatcher({
      rpcUrl: "https://rpc.test",
      bondingContract: BONDING,
      pollIntervalMs: 60_000,
      stateFilePath: stateFile,
      label: "alt.fun",
      tradingUrlTemplate: "https://alt.fun/coin/{token}",
      logger: silentLogger,
      notifier: { notify: notifyMock },
      fetchImpl,
    });

    await watcher.runOnce();
    expect(notifyMock).toHaveBeenCalledOnce();
    expect(notifyMock.mock.calls[0][0].symbol).toBe(token);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
