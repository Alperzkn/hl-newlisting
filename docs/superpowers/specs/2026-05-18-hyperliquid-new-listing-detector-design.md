# Hyperliquid New Listing Detector — Phase 1 Design

**Date:** 2026-05-18
**Status:** Approved for implementation planning
**Phase:** 1 of 2 (detection + notification; auto-trading deferred to phase 2)

## Goal

Detect new asset listings on Hyperliquid (both perpetual futures and spot markets) within ~1 second of going live, and notify the user via Telegram (and optionally a local desktop sound) so they can react manually.

## Non-goals (phase 1)

- Auto-trading / order placement.
- Order book or depth snapshot enrichment.
- Web dashboard or UI.
- Multi-user or multi-account support.
- Tracking de-listings (asset removal from the universe).

Phase 2 will add an auto-trading module that consumes the same `ListingEvent` stream.

## Background

Hyperliquid exposes two distinct asset universes:

- **Perpetual futures** — listed via the `info/meta` REST endpoint (`universe` field).
- **Spot tokens** — listed via the `info/spotMeta` REST endpoint (`universe` field).

Neither WebSocket feed exposes a dedicated "new asset added" event. The only reliable way to detect a listing is to observe a new symbol appearing in `meta` / `spotMeta` between two snapshots. Polling once per second is sufficient: perps and spot do not see meaningful fills in the first second after listing, and 1 Hz polling against the public REST API is well within rate limits.

Community trackers exist (Telegram channels, Discord bots) but are not customizable and do not offer an auto-trading hook, which is why a custom solution is warranted.

## Runtime, language, and deployment

- **Language:** TypeScript on Node.js.
- **SDK:** [`nktkas/hyperliquid`](https://github.com/nktkas/hyperliquid) (community TS SDK; well-maintained, handles signing/REST/WS).
- **Local dev:** runs on macOS via `npm run dev` (tsx watch), state in `./data/`, desktop sound enabled.
- **Production:** runs on the user's existing DigitalOcean droplet as a `systemd` service, state in `/var/lib/hl-newlisting/`, desktop sound disabled.

## Architecture

A single Node.js process composed of three modules with one job each, communicating via in-process events. Each module can be unit-tested independently and replaced without touching the others.

```
┌──────────────────────────────────────────────────────────────┐
│  hl-newlisting (Node.js process)                             │
│                                                              │
│  ┌────────────┐    ┌─────────────┐    ┌──────────────────┐   │
│  │  Poller    │───▶│  Detector   │───▶│  Notifier        │   │
│  │  (1s tick) │    │  (diff +    │    │  (Telegram +     │   │
│  │            │    │   enrich)   │    │   desktop sound) │   │
│  └────────────┘    └─────────────┘    └──────────────────┘   │
│        │                  │                                  │
│        ▼                  ▼                                  │
│   HL REST API       known-assets.json                        │
│   (meta + spotMeta) (persistent state)                       │
└──────────────────────────────────────────────────────────────┘
```

### Modules

**Poller** — pure I/O. Every `POLL_INTERVAL_MS` (default 1000), fetches `info/meta` and `info/spotMeta` in parallel and hands the raw responses to the Detector. No business logic, no state.

**Detector** — the brain. Owns the diff against persisted state, the enrichment fetches, and the state-file write. Emits `ListingEvent` to subscribers. Cold-start logic lives here.

**Notifier** — fan-out. Receives `ListingEvent`s and dispatches to one or more channels (Telegram primary; desktop sound on local). Each channel is a small adapter behind a common interface. In phase 2, a `Trader` adapter is added as another subscriber.

### Common contract

```ts
type ListingEvent = {
  symbol: string;              // e.g., "NEWCOIN"
  market: "perp" | "spot";
  detectedAt: string;          // ISO 8601
  maxLeverage?: number;        // perps only
  midPrice?: number;           // best-effort, may be undefined
  tradingUrl: string;          // https://app.hyperliquid.xyz/trade/<symbol>
};
```

## Data flow

### Per-tick flow

1. **Poll**: fetch `meta.universe` and `spotMeta.universe` in parallel.
2. **Diff**: compare symbol sets against the in-memory cache (mirrored from `known-assets.json`).
3. **For each new symbol**:
   - Fetch enrichment in parallel: `info/allMids` for mid price; `meta` already contains leverage for perps.
   - Build a `ListingEvent`.
4. **Persist state BEFORE notifying** (only if there are new symbols). This ordering matters:
   - Notify-first + crash = re-notify on restart (user-visible spam).
   - Save-first + crash = miss one notification (acceptable; also logged to file).
5. **Emit** `ListingEvent`s to the Notifier.
6. **Update** `lastPollAt` in memory (used by heartbeat).

The state file is only written when the asset set actually changes — most ticks are no-ops and touch nothing on disk. `lastPollAt` lives in memory; it is persisted only as a side effect of a state-file write.

### State file

Location: `./data/known-assets.json` (local), `/var/lib/hl-newlisting/known-assets.json` (prod).

```json
{
  "perps": { "BTC": { "firstSeen": "2024-01-01T00:00:00Z" } },
  "spot":  { "PURR": { "firstSeen": "2024-04-29T00:00:00Z" } },
  "lastPollAt": "2026-05-18T12:34:56.789Z"
}
```

Writes are atomic: write to `known-assets.json.tmp`, then `rename()` over the original. A crash mid-write cannot corrupt the file.

### Cold start

When the state file does not exist (first run), the Detector treats the *entire* current universe as already-known and writes the baseline. It does NOT fire notifications for every existing asset. Listings only count from the moment the bot is first run.

## Error handling

The detector must never die from a transient error. Missing a listing because the process crashed is the worst outcome.

| Failure mode | Behavior |
|---|---|
| HL API timeout / 5xx / network error | Log, skip this tick, retry next tick. No intra-tick retries. |
| Malformed JSON response | Log full payload, skip tick. Do not crash. |
| Telegram send fails | Log `ListingEvent` to `missed-notifications.log` so it can be recovered manually. State is already persisted, so the same event will not re-fire. |
| Desktop sound fails (e.g., on prod) | Silently ignored. Nice-to-have only. |
| Uncaught exception | Top-level handler logs to file and `process.exit(1)`. `systemd` restarts the process. |

## Observability

**Heartbeat:** the Notifier sends a short status line ("still alive — last poll Xs ago — tracking N perps + M spot") to the heartbeat chat every `HEARTBEAT_INTERVAL_MIN` (default 60). A listing notification counts as activity and resets the heartbeat timer (no need to spam a heartbeat right after a real alert). This catches the silent-failure case where the process is running but the poll loop is stuck.

**Logs:** stdout/stderr captured by `journalctl -u hl-newlisting` in prod, terminal locally. Structured one-line JSON per event so logs are greppable.

## Configuration

All configuration is via environment variables. Loaded from `.env` locally and `/etc/hl-newlisting.env` in prod.

| Variable | Default | Purpose |
|---|---|---|
| `HL_API_URL` | `https://api.hyperliquid.xyz` | HL REST base URL |
| `POLL_INTERVAL_MS` | `1000` | Tick interval |
| `TELEGRAM_BOT_TOKEN` | (required) | Bot auth token |
| `TELEGRAM_CHAT_ID` | (required) | Destination chat for listing alerts |
| `TELEGRAM_HEARTBEAT_CHAT_ID` | (optional, defaults to `TELEGRAM_CHAT_ID`) | Destination for heartbeats |
| `HEARTBEAT_INTERVAL_MIN` | `60` | Heartbeat cadence |
| `STATE_FILE_PATH` | `./data/known-assets.json` | State location |
| `ENABLE_DESKTOP_SOUND` | `false` | Play a local sound on detection (local dev only) |

## Notification format

Telegram message for a new listing:

```
🚨 New Hyperliquid listing

Symbol: NEWCOIN
Market: perp (20x max)
Mid:    $1.2345
Time:   2026-05-18 12:34:56 UTC

https://app.hyperliquid.xyz/trade/NEWCOIN
```

For spot listings, the leverage line is omitted.

## Deployment

1. `git clone` the repo to the droplet.
2. `npm ci && npm run build`.
3. Place env file at `/etc/hl-newlisting.env` (mode `0600`, owned by service user).
4. Install `hl-newlisting.service` systemd unit:
   - `User=hl-newlisting` (non-root, created during setup)
   - `WorkingDirectory=/opt/hl-newlisting`
   - `EnvironmentFile=/etc/hl-newlisting.env`
   - `ExecStart=/usr/bin/node dist/index.js`
   - `Restart=always`, `RestartSec=5s`
5. `systemctl enable --now hl-newlisting`.
6. State directory: `/var/lib/hl-newlisting/` (owned by service user).

## Testing strategy

- **Unit tests (Detector):** fake `meta` / `spotMeta` snapshots; assert correct `ListingEvent` emission on new symbol, no emission on unchanged universe, correct cold-start (no events emitted, baseline written), correct ordering (state persisted before emit).
- **Unit tests (state file):** atomic write/read; corrupted-file recovery.
- **Integration test (manual):** point at the live HL testnet (or mainnet) for several minutes, confirm no spurious events and heartbeat works.
- **Poller / Notifier:** thin wrappers over external systems — minimal unit tests, primarily manual verification.

## Phase 2 preview (not in scope)

The architecture deliberately leaves a clean seam for trading: the Notifier is just one consumer of the `ListingEvent` stream. Phase 2 will add a `Trader` module as a second consumer with its own configurable strategy (order type, size, leverage, time-in-force, stop-loss). The detection path does not need to change.
