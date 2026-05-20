// src/notifiers/telegram.ts
import type { ListingEvent, Notifier } from "../types.js";

// "XYZ [xyz]" when the full name adds info, just "alt.fun" when they're the same.
function dexLabel(event: ListingEvent): string {
  if (!event.dex) return "";
  if (event.dexFullName && event.dexFullName !== event.dex) {
    return `${event.dexFullName} [${event.dex}]`;
  }
  return event.dex;
}

// "2026-05-20T15:59:04.288Z" -> "2026-05-20 15:59:04 UTC"
function formatTime(iso: string): string {
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]} UTC` : iso;
}

export function formatListingMessage(event: ListingEvent): string {
  const lines: string[] = [];
  // alt.fun-style HyperEVM graduations are spot pairs carrying a dex label and
  // aren't Hyperliquid L1 listings, so they get their own header.
  const isHyperEvmGraduation = event.market === "spot" && !!event.dex;
  lines.push(
    isHyperEvmGraduation
      ? `🚨 New ${event.dexFullName ?? event.dex} graduation`
      : "🚨 New Hyperliquid listing"
  );
  lines.push("");
  lines.push(`Symbol: ${event.symbol}`);
  if (event.market === "perp") {
    const lev = event.maxLeverage !== undefined ? ` (${event.maxLeverage}x max)` : "";
    if (event.dex) {
      lines.push(`Market: perp on ${dexLabel(event)}${lev}`);
    } else {
      lines.push(`Market: perp${lev}`);
    }
  } else if (event.dex) {
    lines.push(`Market: spot on ${dexLabel(event)}`);
  } else {
    lines.push(`Market: spot`);
  }
  if (event.isNewQuotePair) {
    lines.push(`Note:   New quote pair — ${event.baseToken} already trades on Hyperliquid`);
  }
  if (event.midPrice !== undefined) lines.push(`Mid:    $${event.midPrice}`);
  lines.push(`Time:   ${formatTime(event.detectedAt)}`);
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
