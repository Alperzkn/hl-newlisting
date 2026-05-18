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
