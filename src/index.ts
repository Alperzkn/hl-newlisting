// src/index.ts
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createHlClient } from "./hl-client.js";
import { createPoller } from "./poller.js";
import { createFanoutNotifier } from "./notifier.js";
import { createTelegramNotifier, sendTelegramText } from "./notifiers/telegram.js";
import { createDesktopSoundNotifier } from "./notifiers/desktop-sound.js";
import { createHeartbeat } from "./heartbeat.js";

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
      // Log the full event so a missed notification can be recovered by grepping the journal.
      logger.error("notifier failed", { err: String(err), event });
    },
  });

  let getStatus: () => { lastPollAt: string; perpsCount: number; spotCount: number } = () => ({
    lastPollAt: new Date().toISOString(),
    perpsCount: 0,
    spotCount: 0,
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
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  logger.info("starting hl-newlisting", {
    pollIntervalMs: cfg.pollIntervalMs,
    heartbeatIntervalMin: cfg.heartbeatIntervalMin,
    desktopSound: cfg.enableDesktopSound,
  });

  poller.start(cfg.pollIntervalMs);
  heartbeat.start();
}

main().catch((err) => {
  process.stderr.write(JSON.stringify({ level: "error", msg: "fatal at startup", err: String(err) }) + "\n");
  process.exit(1);
});
