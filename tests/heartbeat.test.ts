import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHeartbeat } from "../src/heartbeat.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("heartbeat", () => {
  it("calls send() after the interval elapses", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const status = vi.fn().mockReturnValue({ lastPollAt: "t", perpsCount: 5, spotCount: 3 });
    const hb = createHeartbeat({ intervalMs: 60_000, send, status });
    hb.start();
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(expect.stringContaining("5 perps"));
    hb.stop();
  });

  it("reset() restarts the timer", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const status = vi.fn().mockReturnValue({ lastPollAt: "t", perpsCount: 0, spotCount: 0 });
    const hb = createHeartbeat({ intervalMs: 60_000, send, status });
    hb.start();
    await vi.advanceTimersByTimeAsync(30_000);
    hb.reset();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(send).toHaveBeenCalledOnce();
    hb.stop();
  });
});
