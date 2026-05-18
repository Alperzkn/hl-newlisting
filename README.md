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
