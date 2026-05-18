// src/config.ts
import "dotenv/config";

export type Config = {
  telegramBotToken: string;
  telegramChatId: string;
  telegramHeartbeatChatId: string;
  hlApiUrl: string;
  pollIntervalMs: number;
  dexPollIntervalMs: number;
  heartbeatIntervalMin: number;
  stateFilePath: string;
  enableDesktopSound: boolean;
  altfun: AltfunConfig | null;
};

export type AltfunConfig = {
  rpcUrl: string;
  factoryAddress: string;
  factoryKind: "v2" | "v3";
  quoteTokenAddress: string | null;
  pollIntervalMs: number;
  stateFilePath: string;
  label: string;
  tradingUrlTemplate: string;
};

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const parsed = Number(v);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number for ${name}: ${v}`);
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return v.toLowerCase() === "true";
}

import path from "node:path";

function loadAltfunConfig(stateFilePath: string): AltfunConfig | null {
  if (!bool("ENABLE_ALTFUN", false)) return null;
  const factoryAddress = process.env.ALTFUN_FACTORY?.trim();
  if (!factoryAddress) {
    throw new Error(
      "ENABLE_ALTFUN=true but ALTFUN_FACTORY is not set. " +
        "Set ALTFUN_FACTORY to the HyperEVM AMM factory address."
    );
  }
  const factoryKindRaw = (process.env.ALTFUN_FACTORY_KIND || "v3").trim().toLowerCase();
  if (factoryKindRaw !== "v2" && factoryKindRaw !== "v3") {
    throw new Error(`ALTFUN_FACTORY_KIND must be "v2" or "v3", got: ${factoryKindRaw}`);
  }
  const quote = process.env.ALTFUN_QUOTE_TOKEN?.trim();
  const defaultStateDir = path.dirname(stateFilePath);
  return {
    rpcUrl: process.env.ALTFUN_RPC_URL || "https://rpc.hyperliquid.xyz/evm",
    factoryAddress,
    factoryKind: factoryKindRaw,
    quoteTokenAddress: quote ? quote : null,
    pollIntervalMs: num("ALTFUN_POLL_INTERVAL_MS", 15000),
    stateFilePath: process.env.ALTFUN_STATE_FILE_PATH || path.join(defaultStateDir, "altfun-state.json"),
    label: process.env.ALTFUN_LABEL || "alt.fun",
    tradingUrlTemplate:
      process.env.ALTFUN_TRADING_URL_TEMPLATE ||
      "https://app.hyperswap.exchange/swap?outputCurrency={token}",
  };
}

export function loadConfig(): Config {
  const telegramBotToken = required("TELEGRAM_BOT_TOKEN");
  const telegramChatId = required("TELEGRAM_CHAT_ID");
  const stateFilePath = process.env.STATE_FILE_PATH || "./data/known-assets.json";
  return {
    telegramBotToken,
    telegramChatId,
    telegramHeartbeatChatId: process.env.TELEGRAM_HEARTBEAT_CHAT_ID || telegramChatId,
    hlApiUrl: process.env.HL_API_URL || "https://api.hyperliquid.xyz",
    pollIntervalMs: num("POLL_INTERVAL_MS", 1000),
    dexPollIntervalMs: num("DEX_POLL_INTERVAL_MS", 10000),
    heartbeatIntervalMin: num("HEARTBEAT_INTERVAL_MIN", 60),
    stateFilePath,
    enableDesktopSound: bool("ENABLE_DESKTOP_SOUND", false),
    altfun: loadAltfunConfig(stateFilePath),
  };
}
