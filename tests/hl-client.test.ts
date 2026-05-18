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

  it("fetchMeta with dex passes the dex param in body", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ universe: [{ name: "xyz:SPCX", maxLeverage: 5 }] }))
    );
    const client = createHlClient("https://api.test");
    const result = await client.fetchMeta("xyz");
    expect(fetchMock).toHaveBeenCalledWith("https://api.test/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "meta", dex: "xyz" }),
    });
    expect(result.symbols).toEqual(new Set(["xyz:SPCX"]));
    expect(result.leverage).toEqual({ "xyz:SPCX": 5 });
  });

  it("fetchPerpDexs returns named dexes and filters the leading null entry", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          null,
          { name: "xyz", fullName: "XYZ" },
          { name: "flx", fullName: "Felix Exchange" },
        ])
      )
    );
    const client = createHlClient("https://api.test");
    const result = await client.fetchPerpDexs();
    expect(fetchMock).toHaveBeenCalledWith("https://api.test/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "perpDexs" }),
    });
    expect(result).toEqual([
      { name: "xyz", fullName: "XYZ" },
      { name: "flx", fullName: "Felix Exchange" },
    ]);
  });
});
