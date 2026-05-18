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
