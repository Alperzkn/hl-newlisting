// src/index.ts
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createHlClient } from "./hl-client.js";
import { createPoller } from "./poller.js";
import type { PollerStatus } from "./poller.js";
import { createFanoutNotifier } from "./notifier.js";
import { createTelegramNotifier, sendTelegramText } from "./notifiers/telegram.js";
import { createDesktopSoundNotifier } from "./notifiers/desktop-sound.js";
import { createHeartbeat } from "./heartbeat.js";
import { createAltfunWatcher } from "./watchers/altfun.js";

async function main() {
  const cfg = loadConfig();
  const logger = createLogger();
  const client = createHlClient(cfg.hlApiUrl);

  const notifiers = [
    createTelegramNotifier({ token: cfg.telegramBotToken, chatId: cfg.telegramChatId }),
  ];
  if (cfg.enableDesktopSound) notifiers.push(createDesktopSoundNotifier());

  const notifier = createFanoutNotifier(notifiers, {
    onError: (err, event) => {
      logger.error("notifier failed", { err: String(err), event });
    },
  });

  let getStatus: () => PollerStatus = () => ({
    lastPollAt: new Date().toISOString(),
    perpsCount: 0,
    spotCount: 0,
    dexCount: 0,
    dexAssetsCount: 0,
  });

  const heartbeat = createHeartbeat({
    intervalMs: cfg.heartbeatIntervalMin * 60_000,
    send: (text) => sendTelegramText(cfg.telegramBotToken, cfg.telegramHeartbeatChatId, text),
    status: () => getStatus(),
  });

  const poller = createPoller({
    client,
    notifier,
    logger,
    stateFilePath: cfg.stateFilePath,
    onListing: () => heartbeat.reset(),
  });
  getStatus = () => poller.getStatus();

  const altfun = cfg.altfun
    ? createAltfunWatcher({
        rpcUrl: cfg.altfun.rpcUrl,
        factoryAddress: cfg.altfun.factoryAddress,
        factoryKind: cfg.altfun.factoryKind,
        quoteTokenAddress: cfg.altfun.quoteTokenAddress ?? undefined,
        tokenImplementationAddress: cfg.altfun.tokenImplementationAddress ?? undefined,
        pollIntervalMs: cfg.altfun.pollIntervalMs,
        stateFilePath: cfg.altfun.stateFilePath,
        label: cfg.altfun.label,
        tradingUrlTemplate: cfg.altfun.tradingUrlTemplate,
        logger,
        notifier,
        onListing: () => heartbeat.reset(),
      })
    : null;

  process.on("uncaughtException", (err) => {
    logger.error("uncaughtException", { err: String(err) });
    process.exit(1);
  });
  process.on("unhandledRejection", (err) => {
    logger.error("unhandledRejection", { err: String(err) });
    process.exit(1);
  });

  const shutdown = (signal: string) => {
    logger.info("shutting down", { signal });
    poller.stop();
    heartbeat.stop();
    altfun?.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  logger.info("starting hl-newlisting", {
    pollIntervalMs: cfg.pollIntervalMs,
    dexPollIntervalMs: cfg.dexPollIntervalMs,
    heartbeatIntervalMin: cfg.heartbeatIntervalMin,
    desktopSound: cfg.enableDesktopSound,
    altfun: cfg.altfun
      ? {
          factory: cfg.altfun.factoryAddress,
          quote: cfg.altfun.quoteTokenAddress,
          label: cfg.altfun.label,
          pollIntervalMs: cfg.altfun.pollIntervalMs,
        }
      : null,
  });

  poller.start({ pollIntervalMs: cfg.pollIntervalMs, dexPollIntervalMs: cfg.dexPollIntervalMs });
  heartbeat.start();
  altfun?.start();
}

main().catch((err) => {
  process.stderr.write(JSON.stringify({ level: "error", msg: "fatal at startup", err: String(err) }) + "\n");
  process.exit(1);
});
