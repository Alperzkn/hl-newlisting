# hl-newlisting

A small TypeScript service that detects newly-listed [Hyperliquid](https://hyperliquid.xyz) perp and spot assets within ~1 second and notifies you on Telegram. Optionally plays a desktop sound on macOS.

Built so that a phase-2 auto-trading module can consume the same `ListingEvent` stream without touching detection.

## Features

- Polls Hyperliquid's `meta` and `spotMeta` endpoints once per second for main perps and spot.
- Polls every HIP-3 builder-deployed perp dex (XYZ, Felix, Ventuals, HyENA, Kinetiq Markets, ABCDEx, dreamcash, Paragon, …) on a separate slower cycle so SPCX, NVDA-perp, etc. don't get missed.
- Detects new symbols by diffing against persisted state — and treats brand-new dexes as silent cold-starts so a freshly-deployed dex doesn't spam its entire universe at once.
- Notifies via Telegram with symbol, market (incl. dex name for builder perps), max leverage, mid price, and a direct trading link.
- Periodic heartbeat to Telegram so you can tell whether the service is alive.
- Atomic state writes — a crash mid-write cannot corrupt the state file.
- Cold-start baselines the current universe without firing false alerts.
- Pluggable notifier fan-out — drop in extra channels or a trading module without touching the detector.
- 43 unit tests, strict TypeScript, no production dependencies beyond `dotenv` (uses native `fetch`).

## How it works

```text
┌──────────────┐    ┌──────────────┐    ┌────────────────────┐
│  Poller      │───▶│  Detector    │───▶│  Notifier fan-out  │
│  (1s tick)   │    │  (diff +     │    │  Telegram          │
│              │    │   enrich)    │    │  + desktop sound   │
└──────────────┘    └──────────────┘    └────────────────────┘
       │                   │
       ▼                   ▼
  HL REST API        known-assets.json
```

Full design rationale: [docs/superpowers/specs/2026-05-18-hyperliquid-new-listing-detector-design.md](docs/superpowers/specs/2026-05-18-hyperliquid-new-listing-detector-design.md).

## Requirements

- Node.js 20 or newer.
- A Telegram bot token and your chat ID (see [Telegram bot setup](#telegram-bot-setup) below).
- macOS only for the optional desktop sound (`afplay`). The rest is cross-platform.

## Quick start

```bash
git clone https://github.com/alperzkn/hl-newlisting.git
cd hl-newlisting
npm install
cp .env.example .env
# edit .env and fill in TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
npm run dev
```

You should see two log lines within a couple of seconds:

```json
{"ts":"...","level":"info","msg":"starting hl-newlisting", ...}
{"ts":"...","level":"info","msg":"cold start: baseline written","perps":230,"spot":297}
```

From then on the process logs only on errors, new listings, and heartbeats.

## Telegram bot setup

1. Open Telegram and message [@BotFather](https://t.me/BotFather). Send `/newbot`, follow the prompts, and save the token it gives you.
2. Send any message to your new bot from your own account.
3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser. Find `result[0].message.chat.id` — that's your `TELEGRAM_CHAT_ID`.

## Configuration

All configuration is via environment variables, loaded from `.env` locally or `/etc/hl-newlisting.env` in production.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | ✓ | — | Bot auth token from @BotFather |
| `TELEGRAM_CHAT_ID` | ✓ | — | Destination chat for listing alerts |
| `TELEGRAM_HEARTBEAT_CHAT_ID` | | same as `TELEGRAM_CHAT_ID` | Destination for periodic heartbeats |
| `HL_API_URL` | | `https://api.hyperliquid.xyz` | Hyperliquid REST base URL |
| `POLL_INTERVAL_MS` | | `1000` | Tick interval for main perps + spot in milliseconds |
| `DEX_POLL_INTERVAL_MS` | | `10000` | Tick interval for the HIP-3 builder dex sweep |
| `HEARTBEAT_INTERVAL_MIN` | | `60` | Heartbeat cadence in minutes |
| `STATE_FILE_PATH` | | `./data/known-assets.json` | Where to persist the known-asset state |
| `ENABLE_DESKTOP_SOUND` | | `false` | Play `Glass.aiff` on detection (macOS only) |
| `ENABLE_ALTFUN` | | `false` | Watch alt.fun's Bonding contract for graduations |
| `ALTFUN_BONDING_CONTRACT` | | `0xb68811BcC0e4FcD825aA49F9453b065ddF752FcB` | alt.fun Bonding contract emitting `TokenGraduated` |
| `ALTFUN_RPC_URL` | | `https://rpc.hyperliquid.xyz/evm` | HyperEVM JSON-RPC endpoint |
| `ALTFUN_POLL_INTERVAL_MS` | | `15000` | Sweep cadence for the HyperEVM watcher |
| `ALTFUN_LABEL` | | `alt.fun` | Shown in Telegram messages (`Market: spot on alt.fun`) |
| `ALTFUN_TRADING_URL_TEMPLATE` | | `https://alt.fun/coin/{token}` | `{token}` / `{pair}` substituted at notify time |
| `ALTFUN_STATE_FILE_PATH` | | `<dir-of-STATE_FILE_PATH>/altfun-state.json` | Where the watcher persists `lastBlock` |

## Optional: alt.fun graduation watcher

By default, this service polls Hyperliquid's L1 endpoints — it sees main perps, spot pairs, and HIP-3 builder dexes. It does **not** see HyperEVM-only tokens (alt.fun, pump-fun clones, etc.) because they live on the EVM side of Hyperliquid and never appear in `info/meta` or `info/spotMeta`.

If you want alt.fun graduations too, enable the HyperEVM watcher. It polls alt.fun's **Bonding contract** for the `TokenGraduated` event — the authoritative graduation signal documented at [docs.alt.fun/integrations](https://docs.alt.fun/integrations). The event names the graduated token and its new AMM pool directly, so there's no token-ordering or quote-token guesswork. The watcher resolves the token's `symbol()` via `eth_call` and fires the same `ListingEvent` into the same notifier fan-out.

```bash
# In .env:
ENABLE_ALTFUN=true
ALTFUN_BONDING_CONTRACT=0xb68811BcC0e4FcD825aA49F9453b065ddF752FcB
```

`TokenGraduated(address indexed token, address indexed pairAddress, …)` fires when a token's bonding curve hits the threshold and liquidity migrates to an AMM pool. Brand-new tokens that are still on the bonding curve do **not** trigger this — only graduations.

The watcher persists `lastBlock` to `altfun-state.json` so restarts don't re-scan history. HyperEVM's public RPC limits `eth_getLogs` to 1000-block windows; the watcher chunks queries automatically.

## Notification format

```text
🚨 New Hyperliquid listing

Symbol: NEWCOIN
Market: perp (20x max)
Mid:    $1.2345
Time:   2026-05-18T12:34:56.789Z

https://app.hyperliquid.xyz/trade/NEWCOIN
```

For spot listings the leverage line is omitted.

## Development

```bash
npm run dev        # run with auto-reload via tsx watch
npm test           # run the test suite (34 tests)
npm run typecheck  # type-check without emitting JS
npm run build      # compile to dist/
npm start          # run the compiled build
```

### Project layout

```text
src/
├── index.ts              # entry point, wires modules
├── config.ts             # env var loading + validation
├── types.ts              # ListingEvent, AssetSnapshot, KnownAssets
├── logger.ts             # one-line JSON structured logger
├── state.ts              # known-assets.json atomic read/write + diff
├── hl-client.ts          # HL REST client (fetch wrapper)
├── detector.ts           # diff → enrich → emit ListingEvent
├── poller.ts             # 1Hz tick driving the detector
├── heartbeat.ts          # periodic status to Telegram
├── notifier.ts           # fan-out interface
└── notifiers/
    ├── telegram.ts       # Telegram Bot API adapter
    └── desktop-sound.ts  # macOS `afplay` adapter
```

### Verifying detection locally

Because the poller keeps the known-asset map in memory after cold start, the easiest way to simulate a fake "new listing" is to **edit the state file and restart** the process:

```bash
# stop the service (Ctrl+C), then:
node -e '
const fs=require("fs");
const p="./data/known-assets.json";
const s=JSON.parse(fs.readFileSync(p,"utf8"));
const victim=Object.keys(s.perps)[0];
console.log("removing perp:",victim);
delete s.perps[victim];
fs.writeFileSync(p,JSON.stringify(s,null,2));
'

# restart
npm run dev
```

Within ~2 seconds you should see a `"new listing"` log line and a Telegram message.

## Deployment

Two deployment styles are supported out of the box: **PM2** (easier if you already use it for other Node services) and **systemd** (more isolated, no Node-specific dependencies).

### Option A — PM2 (Ubuntu / Debian VPS)

Prerequisites: Node 20+, git, PM2 globally installed (`npm install -g pm2`).

```bash
# SSH into your VPS, then:
node -v   # must be >= 20
git clone https://github.com/alperzkn/hl-newlisting.git ~/hl-newlisting
cd ~/hl-newlisting
npm ci
npm run build

# Create .env with your secrets (file is gitignored)
cp .env.example .env
nano .env   # fill in TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
chmod 0600 .env

# Start under PM2
pm2 start ecosystem.config.cjs
pm2 save                 # persist the process list across reboots
pm2 startup              # run the printed command once if you haven't already

# Verify
pm2 status hl-newlisting
pm2 logs hl-newlisting --lines 50
```

To update:

```bash
~/hl-newlisting/deploy/update.sh
```

The script pulls `origin/main`, refuses to run if the working tree is dirty, reinstalls dependencies, rebuilds, and restarts the PM2 app (or starts it if it was stopped). Pass `BRANCH=somebranch` to deploy from a non-default branch.

### Option B — systemd (any Linux host)

Prerequisites: Node 20+, git.

```bash
# As root, one-time setup
sudo useradd --system --shell /usr/sbin/nologin --home /opt/hl-newlisting hl-newlisting
sudo mkdir -p /opt/hl-newlisting /var/lib/hl-newlisting
sudo chown hl-newlisting:hl-newlisting /var/lib/hl-newlisting

# Deploy the code (run as your normal user)
sudo git clone https://github.com/alperzkn/hl-newlisting.git /opt/hl-newlisting
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

To update:

```bash
cd /opt/hl-newlisting
sudo -u hl-newlisting git pull
sudo npm ci --omit=dev
sudo npm run build
sudo systemctl restart hl-newlisting
```

## Continuous deployment (GitHub Actions)

Once the PM2 deployment is running, you can have GitHub auto-deploy on every push to `main`. The workflow ([.github/workflows/deploy.yml](.github/workflows/deploy.yml)) SSHes into the VPS and runs `deploy/update.sh`.

**Note on SSH direction:** pulling from the repo on your VPS is *VPS → GitHub*. This deploy is the opposite — *GitHub → VPS* — so it needs its own deploy key that GitHub holds.

One-time setup:

```bash
# 1. On your machine (or the VPS), generate a dedicated deploy keypair (no passphrase):
ssh-keygen -t ed25519 -f ~/.ssh/hl_deploy -N "" -C "github-actions-deploy"

# 2. Authorize the PUBLIC key on the VPS:
ssh-copy-id -i ~/.ssh/hl_deploy.pub youruser@your-vps-ip
#   (or append the contents of hl_deploy.pub to ~/.ssh/authorized_keys on the VPS)

# 3. Print the PRIVATE key to copy into GitHub:
cat ~/.ssh/hl_deploy
```

Then in the GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**, add:

| Secret | Value |
| --- | --- |
| `VPS_HOST` | your droplet IP or hostname |
| `VPS_USER` | SSH user that owns the PM2 process (e.g. `root`) |
| `VPS_SSH_KEY` | the full private key from step 3 (incl. the `BEGIN`/`END` lines) |
| `VPS_PORT` | SSH port (usually `22`) |

After that, every `git push` to `main` triggers a deploy. Watch it under the repo's **Actions** tab. If a deploy fails, the logs there show exactly which step broke.

## Public notifications via a Telegram channel

To let anyone receive alerts without per-user setup, broadcast to a public Telegram **channel** instead of a single chat:

1. In Telegram: **New Channel** → make it **public** with a username (e.g. `@my_hl_alerts`).
2. Channel **Administrators → Add Admin →** add your bot, grant **Post Messages**.
3. Set `TELEGRAM_CHAT_ID` to the channel — either `@my_hl_alerts` or the numeric ID (`-100…`). To get the numeric ID, post once in the channel and open `https://api.telegram.org/bot<TOKEN>/getUpdates`.
4. **Keep heartbeats out of the public channel:** set `TELEGRAM_HEARTBEAT_CHAT_ID` to your *personal* chat ID so the hourly "still alive" pings don't spam subscribers.

Anyone who joins the channel link then gets every listing alert automatically — no code changes, no subscriber management.

## Phase 2 — auto-trading (not in scope here)

The notifier is just one consumer of the `ListingEvent` stream. A trading module can be added as a second consumer — register it alongside the notifier in [src/index.ts](src/index.ts) and the detection path stays untouched. Strategy, sizing, and risk parameters belong inside that module.

## Contributing

Issues and pull requests are welcome. Please run `npm test` and `npm run typecheck` before opening a PR.

## License

[MIT](LICENSE) © alperzkn
