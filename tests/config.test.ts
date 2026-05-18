import { describe, it, expect, beforeEach } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  beforeEach(() => {
    // Clear vars the test needs control over
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    delete process.env.HL_API_URL;
    delete process.env.POLL_INTERVAL_MS;
    delete process.env.HEARTBEAT_INTERVAL_MIN;
    delete process.env.STATE_FILE_PATH;
    delete process.env.TELEGRAM_HEARTBEAT_CHAT_ID;
    delete process.env.ENABLE_DESKTOP_SOUND;
  });

  it("throws when required vars missing", () => {
    expect(() => loadConfig()).toThrow(/TELEGRAM_BOT_TOKEN/);
  });

  it("returns config with defaults when only required vars set", () => {
    process.env.TELEGRAM_BOT_TOKEN = "abc";
    process.env.TELEGRAM_CHAT_ID = "123";
    const cfg = loadConfig();
    expect(cfg.telegramBotToken).toBe("abc");
    expect(cfg.telegramChatId).toBe("123");
    expect(cfg.hlApiUrl).toBe("https://api.hyperliquid.xyz");
    expect(cfg.pollIntervalMs).toBe(1000);
    expect(cfg.heartbeatIntervalMin).toBe(60);
    expect(cfg.stateFilePath).toBe("./data/known-assets.json");
    expect(cfg.telegramHeartbeatChatId).toBe("123"); // defaults to main chat
    expect(cfg.enableDesktopSound).toBe(false);
  });

  it("parses numeric env vars", () => {
    process.env.TELEGRAM_BOT_TOKEN = "abc";
    process.env.TELEGRAM_CHAT_ID = "123";
    process.env.POLL_INTERVAL_MS = "500";
    process.env.HEARTBEAT_INTERVAL_MIN = "10";
    const cfg = loadConfig();
    expect(cfg.pollIntervalMs).toBe(500);
    expect(cfg.heartbeatIntervalMin).toBe(10);
  });

  it("parses ENABLE_DESKTOP_SOUND=true", () => {
    process.env.TELEGRAM_BOT_TOKEN = "abc";
    process.env.TELEGRAM_CHAT_ID = "123";
    process.env.ENABLE_DESKTOP_SOUND = "true";
    expect(loadConfig().enableDesktopSound).toBe(true);
  });
});
