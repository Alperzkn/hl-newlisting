import { describe, it, expect, vi } from "vitest";
import { createFanoutNotifier } from "../src/notifier.js";
import type { Notifier, ListingEvent } from "../src/types.js";

const event: ListingEvent = {
  symbol: "X",
  market: "perp",
  detectedAt: "t",
  tradingUrl: "u",
};

describe("createFanoutNotifier", () => {
  it("calls every child notifier", async () => {
    const a: Notifier = { notify: vi.fn().mockResolvedValue(undefined) };
    const b: Notifier = { notify: vi.fn().mockResolvedValue(undefined) };
    const fanout = createFanoutNotifier([a, b], { onError: () => {} });
    await fanout.notify(event);
    expect(a.notify).toHaveBeenCalledWith(event);
    expect(b.notify).toHaveBeenCalledWith(event);
  });

  it("does not throw when one notifier fails — calls onError", async () => {
    const a: Notifier = { notify: vi.fn().mockRejectedValue(new Error("boom")) };
    const b: Notifier = { notify: vi.fn().mockResolvedValue(undefined) };
    const onError = vi.fn();
    const fanout = createFanoutNotifier([a, b], { onError });
    await fanout.notify(event);
    expect(b.notify).toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), event);
  });
});
