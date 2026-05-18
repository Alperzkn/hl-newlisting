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
