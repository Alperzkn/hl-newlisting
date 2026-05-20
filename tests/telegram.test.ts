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

  it("uses a graduation header and de-duped label for alt.fun", () => {
    const event: ListingEvent = {
      symbol: "AURA",
      market: "spot",
      dex: "alt.fun",
      dexFullName: "alt.fun",
      detectedAt: "2026-05-20T05:17:08.000Z",
      tradingUrl: "https://alt.fun/coin/0xabc",
    };
    const msg = formatListingMessage(event);
    expect(msg).toContain("New alt.fun graduation");
    expect(msg).not.toContain("New Hyperliquid listing");
    // de-duped: "spot on alt.fun", not "spot on alt.fun [alt.fun]"
    expect(msg).toContain("Market: spot on alt.fun");
    expect(msg).not.toContain("[alt.fun]");
  });

  it("keeps the 'FullName [code]' label for HIP-3 dex perps", () => {
    const event: ListingEvent = {
      symbol: "xyz:SPCX",
      market: "perp",
      dex: "xyz",
      dexFullName: "XYZ",
      maxLeverage: 5,
      detectedAt: "2026-05-20T12:00:00.000Z",
      tradingUrl: "https://app.hyperliquid.xyz/trade/xyz:SPCX",
    };
    const msg = formatListingMessage(event);
    expect(msg).toContain("New Hyperliquid listing");
    expect(msg).toContain("Market: perp on XYZ [xyz] (5x max)");
  });

  it("adds a note for a new quote pair of an existing token", () => {
    const event: ListingEvent = {
      symbol: "KNTQ/USDC",
      market: "spot",
      detectedAt: "2026-05-20T12:59:21.000Z",
      tradingUrl: "https://app.hyperliquid.xyz/trade/KNTQ/USDC",
      isNewQuotePair: true,
      baseToken: "KNTQ",
    };
    const msg = formatListingMessage(event);
    expect(msg).toMatch(/New quote pair/i);
    expect(msg).toContain("KNTQ already trades");
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
