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
  bondingContract: string;
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
  const defaultStateDir = path.dirname(stateFilePath);
  return {
    rpcUrl: process.env.ALTFUN_RPC_URL || "https://rpc.hyperliquid.xyz/evm",
    // alt.fun's Bonding contract (lifecycle / curve state). It emits the
    // authoritative TokenGraduated event. See https://docs.alt.fun/integrations.
    bondingContract:
      process.env.ALTFUN_BONDING_CONTRACT?.trim() ||
      "0xb68811BcC0e4FcD825aA49F9453b065ddF752FcB",
    pollIntervalMs: num("ALTFUN_POLL_INTERVAL_MS", 15000),
    stateFilePath: process.env.ALTFUN_STATE_FILE_PATH || path.join(defaultStateDir, "altfun-state.json"),
    label: process.env.ALTFUN_LABEL || "alt.fun",
    tradingUrlTemplate: process.env.ALTFUN_TRADING_URL_TEMPLATE || "https://alt.fun/coin/{token}",
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
