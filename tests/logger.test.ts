import { describe, it, expect, vi } from "vitest";
import { createLogger } from "../src/logger.js";

describe("createLogger", () => {
  it("writes one-line JSON to stdout", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const log = createLogger();
    log.info("hello", { foo: "bar" });
    expect(spy).toHaveBeenCalledOnce();
    const line = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(line.trim());
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("hello");
    expect(parsed.foo).toBe("bar");
    expect(typeof parsed.ts).toBe("string");
  });

  it("writes error level to stderr", () => {
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const log = createLogger();
    log.error("boom", { code: 1 });
    expect(out).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledOnce();
    const line = err.mock.calls[0][0] as string;
    expect(JSON.parse(line.trim()).level).toBe("error");
  });
});
