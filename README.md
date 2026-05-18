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
| `ENABLE_ALTFUN` | | `false` | Watch a HyperEVM AMM factory for new pools (alt.fun graduations) |
| `ALTFUN_FACTORY` | required if `ENABLE_ALTFUN=true` | — | HyperEVM factory contract emitting `PairCreated` |
| `ALTFUN_QUOTE_TOKEN` | | (none) | Only alert on pairs that include this token (filters noise) |
| `ALTFUN_RPC_URL` | | `https://rpc.hyperliquid.xyz/evm` | HyperEVM JSON-RPC endpoint |
| `ALTFUN_POLL_INTERVAL_MS` | | `15000` | Sweep cadence for the HyperEVM watcher |
| `ALTFUN_LABEL` | | `alt.fun` | Shown in Telegram messages (`Market: spot on alt.fun`) |
| `ALTFUN_TRADING_URL_TEMPLATE` | | `https://app.hyperswap.exchange/swap?outputCurrency={token}` | `{token}` is substituted with the new token address |
| `ALTFUN_STATE_FILE_PATH` | | `<dir-of-STATE_FILE_PATH>/altfun-state.json` | Where the watcher persists `lastBlock` |

## Optional: alt.fun / HyperEVM watcher

By default, this service polls Hyperliquid's L1 endpoints — it sees main perps, spot pairs, and HIP-3 builder dexes. It does **not** see HyperEVM-only tokens (alt.fun, pump-fun clones, etc.) because they live on the EVM side of Hyperliquid and never appear in `info/meta` or `info/spotMeta`.

If you want to catch those too, enable the HyperEVM watcher. It polls a configurable AMM factory contract for `PairCreated` events (Uniswap V2 style), resolves the new token's `symbol()` via `eth_call`, and fires the same `ListingEvent` into the same notifier fan-out — so you get a normal Telegram alert when a new pool appears.

```bash
# In .env on the VPS:
ENABLE_ALTFUN=true
ALTFUN_FACTORY=0xYourHyperSwapFactoryAddressHere
# Optional — only alert when the pair includes this quote token (e.g., USDC):
ALTFUN_QUOTE_TOKEN=
```

**Finding the right factory address:** the HyperEVM ecosystem moves fast and DEX deployment addresses occasionally change. Don't trust addresses from this README or third-party tutorials blindly — verify before enabling:

1. Open a recently-graduated alt.fun token's pool contract on the HyperEVM explorer.
2. Read its `factory()` method (every Uniswap V2 pair has one).
3. Use that returned address as `ALTFUN_FACTORY`.

If `ALTFUN_QUOTE_TOKEN` is left empty, you'll be alerted on **every** pool creation on that factory — useful if you want maximum coverage but noisy. Setting it to e.g. USDC on HyperEVM narrows alerts to just USDC-paired graduations.

The watcher persists `lastBlock` to `altfun-state.json` so restarts don't re-scan history.

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

## Phase 2 — auto-trading (not in scope here)

The notifier is just one consumer of the `ListingEvent` stream. A trading module can be added as a second consumer — register it alongside the notifier in [src/index.ts](src/index.ts) and the detection path stays untouched. Strategy, sizing, and risk parameters belong inside that module.

## Contributing

Issues and pull requests are welcome. Please run `npm test` and `npm run typecheck` before opening a PR.

## License

[MIT](LICENSE) © alperzkn
