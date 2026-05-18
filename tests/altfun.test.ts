import { describe, it, expect, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createAltfunWatcher,
  decodeAbiString,
  eip1167Implementation,
  eventTopicFor,
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

describe("eip1167Implementation", () => {
  it("extracts the implementation address from a minimal-proxy bytecode", () => {
    const code =
      "0x363d3d373d3d3d363d73fbec3d3c42427dc2c08a2401e53758f02cecb5405af43d82803e903d91602b57fd5bf3";
    expect(eip1167Implementation(code)).toBe("0xfbec3d3c42427dc2c08a2401e53758f02cecb540");
  });

  it("returns null for non-proxy bytecode", () => {
    expect(eip1167Implementation("0x6080604052")).toBeNull();
    expect(eip1167Implementation("0x")).toBeNull();
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
      factoryKind: "v2",
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
      factoryKind: "v2",
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

  it("decodes V3 PoolCreated where pool address is the second 32-byte data slot", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "altfun-"));
    const stateFile = path.join(tmpDir, "altfun-state.json");
    await fs.writeFile(stateFile, JSON.stringify({ lastBlock: 100, lastSweepAt: "t0" }));

    const newToken = "0x495f3eb3ac312e03158a58f1c995dbd791500000";
    const quote = "0x5555555555555555555555555555555555555555";
    const pool = "0x4a96c7b51b8d091b4b3bad81933f21f491c5d2bc";
    const v3Topic = eventTopicFor("v3");
    const pad = (a: string) => "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
    const v3Log = {
      // PoolCreated has 4 topics: sig, token0, token1, fee
      topics: [v3Topic, pad(newToken), pad(quote), pad("0xbb8")],
      // data: tickSpacing (slot 0) + pool address (slot 1)
      data:
        "0x" +
        "00".repeat(31) +
        "3c" + // tickSpacing = 60
        pool.toLowerCase().replace(/^0x/, "").padStart(64, "0"),
      transactionHash: "0xdef",
      blockNumber: "0x96",
    };
    const symbolHex =
      "0x" +
      "0000000000000000000000000000000000000000000000000000000000000020" +
      "0000000000000000000000000000000000000000000000000000000000000006" +
      "53544f4e4b53" +
      "00".repeat(26);
    const nameHex =
      "0x" +
      "0000000000000000000000000000000000000000000000000000000000000020" +
      "0000000000000000000000000000000000000000000000000000000000000006" +
      "53746f6e6b73" +
      "00".repeat(26);

    const fetchImpl = makeRpcResponses(
      { method: "eth_blockNumber", result: "0x96" },
      { method: "eth_getLogs", result: [v3Log] },
      { method: "eth_call", result: symbolHex },
      { method: "eth_call", result: nameHex }
    );

    const notifyMock = vi.fn().mockResolvedValue(undefined);
    const watcher = createAltfunWatcher({
      rpcUrl: "https://rpc.test",
      factoryAddress: "0xff7b3e8c00e57ea31477c32a5b52a58eea47b072",
      factoryKind: "v3",
      quoteTokenAddress: quote,
      pollIntervalMs: 60_000,
      stateFilePath: stateFile,
      label: "alt.fun",
      tradingUrlTemplate: "https://example.test/{token}?pool={pair}",
      logger: silentLogger,
      notifier: { notify: notifyMock },
      fetchImpl,
    });

    await watcher.runOnce();
    expect(notifyMock).toHaveBeenCalledOnce();
    const event = notifyMock.mock.calls[0][0];
    expect(event.symbol).toBe("STONKS");
    expect(event.market).toBe("spot");
    expect(event.dex).toBe("alt.fun");
    expect(event.tradingUrl).toBe(`https://example.test/${newToken}?pool=${pool}`);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("skips pools where neither token is an EIP-1167 proxy to the configured impl", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "altfun-"));
    const stateFile = path.join(tmpDir, "altfun-state.json");
    await fs.writeFile(stateFile, JSON.stringify({ lastBlock: 100, lastSweepAt: "t0" }));

    const tokenA = "0x0c63c0fb1e95c8a337835e358fe9a83dc1e01d1e"; // HYPERSQUANCH — not a proxy
    const tokenB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const pool = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    const v3Topic = eventTopicFor("v3");
    const pad = (a: string) => "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
    const v3Log = {
      topics: [v3Topic, pad(tokenA), pad(tokenB), pad("0x2710")],
      data: "0x" + "00".repeat(31) + "c8" + pool.toLowerCase().replace(/^0x/, "").padStart(64, "0"),
      transactionHash: "0xnope",
      blockNumber: "0x96",
    };
    const nonProxyBytecode = "0x6080604052";

    const fetchImpl = makeRpcResponses(
      { method: "eth_blockNumber", result: "0x96" },
      { method: "eth_getLogs", result: [v3Log] },
      { method: "eth_getCode", result: nonProxyBytecode },
      { method: "eth_getCode", result: nonProxyBytecode }
      // No eth_call should follow — pool is skipped.
    );

    const notifyMock = vi.fn().mockResolvedValue(undefined);
    const watcher = createAltfunWatcher({
      rpcUrl: "https://rpc.test",
      factoryAddress: "0xff7b3e8c00e57ea31477c32a5b52a58eea47b072",
      factoryKind: "v3",
      tokenImplementationAddress: "0xfbec3d3c42427dc2c08a2401e53758f02cecb540",
      pollIntervalMs: 60_000,
      stateFilePath: stateFile,
      label: "alt.fun",
      tradingUrlTemplate: "https://alt.fun/coin/{token}",
      logger: silentLogger,
      notifier: { notify: notifyMock },
      fetchImpl,
    });

    await watcher.runOnce();
    expect(notifyMock).not.toHaveBeenCalled();

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("picks the EIP-1167 proxy token (not token0) as the new listing — fixes V3 token ordering", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "altfun-"));
    const stateFile = path.join(tmpDir, "altfun-state.json");
    await fs.writeFile(stateFile, JSON.stringify({ lastBlock: 100, lastSweepAt: "t0" }));

    // Reproduces the real ALTSZN graduation: token0 is the spoof "USDC" (not a proxy),
    // token1 is the alt.fun token (proxy to 0xfbec…b540). The watcher must pick token1.
    const spoofUsdc = "0xb88339cb7199b77e23db6e890353e22632ba630f"; // token0 — regular contract
    const altfunToken = "0xc8c1829078ec5735d40ac3ff39e6403c34000000"; // token1 — proxy
    const impl = "0xfbec3d3c42427dc2c08a2401e53758f02cecb540";
    const pool = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    const v3Topic = eventTopicFor("v3");
    const pad = (a: string) => "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
    const v3Log = {
      topics: [v3Topic, pad(spoofUsdc), pad(altfunToken), pad("0x2710")],
      data:
        "0x" +
        "00".repeat(31) + "c8" +
        pool.toLowerCase().replace(/^0x/, "").padStart(64, "0"),
      transactionHash: "0xfed",
      blockNumber: "0x96",
    };
    const proxyBytecode =
      "0x363d3d373d3d3d363d73" +
      impl.slice(2) +
      "5af43d82803e903d91602b57fd5bf3";
    const altsznSymHex =
      "0x" +
      "0000000000000000000000000000000000000000000000000000000000000020" +
      "0000000000000000000000000000000000000000000000000000000000000006" +
      "414c54535a4e" + // "ALTSZN"
      "00".repeat(26);
    const altsznNameHex =
      "0x" +
      "0000000000000000000000000000000000000000000000000000000000000020" +
      "0000000000000000000000000000000000000000000000000000000000000006" +
      "414c54535a4e" +
      "00".repeat(26);
    // Spoof USDC bytecode (just a non-proxy stub)
    const spoofBytecode = "0x6080604052";

    const fetchImpl = makeRpcResponses(
      { method: "eth_blockNumber", result: "0x96" },
      { method: "eth_getLogs", result: [v3Log] },
      // pickNewToken calls eth_getCode on token0 then token1 (Promise.all order is
      // implementation-defined but our mock requires deterministic ordering, so we
      // match the order the implementation actually emits)
      { method: "eth_getCode", result: spoofBytecode },
      { method: "eth_getCode", result: proxyBytecode },
      { method: "eth_call", result: altsznSymHex }, // symbol()
      { method: "eth_call", result: altsznNameHex } // name()
    );

    const notifyMock = vi.fn().mockResolvedValue(undefined);
    const watcher = createAltfunWatcher({
      rpcUrl: "https://rpc.test",
      factoryAddress: "0xff7b3e8c00e57ea31477c32a5b52a58eea47b072",
      factoryKind: "v3",
      tokenImplementationAddress: impl,
      pollIntervalMs: 60_000,
      stateFilePath: stateFile,
      label: "alt.fun",
      tradingUrlTemplate: "https://example.test/{token}",
      logger: silentLogger,
      notifier: { notify: notifyMock },
      fetchImpl,
    });

    await watcher.runOnce();
    expect(notifyMock).toHaveBeenCalledOnce();
    const event = notifyMock.mock.calls[0][0];
    expect(event.symbol).toBe("ALTSZN");
    // CRUCIAL: the URL must point at the alt.fun token (token1), NOT the spoof USDC (token0)
    expect(event.tradingUrl).toBe(`https://example.test/${altfunToken}`);

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
      factoryKind: "v2",
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
