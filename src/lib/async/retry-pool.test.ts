import { describe, expect, it, vi } from "vitest";

import { mapWithConcurrency } from "./pool";
import { withRetry } from "./retry";

describe("withRetry", () => {
  it("retries transient failures and returns the eventual result", async () => {
    const sleep = vi.fn(async () => undefined);
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce({ code: "57014", message: "canceling statement due to statement timeout" })
      .mockResolvedValue("ok");

    await expect(withRetry(operation, { attempts: 3, sleep })).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("throws permanent failures immediately", async () => {
    const sleep = vi.fn(async () => undefined);
    const failure = { code: "42501", message: "permission denied" };
    await expect(withRetry(() => Promise.reject(failure), { sleep })).rejects.toBe(failure);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("waits exactly as long as a rate limit asks", async () => {
    const sleep = vi.fn(async () => undefined);
    const operation = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce({ code: "P0429", message: "Slow down.", hint: "retry_after=3" })
      .mockResolvedValue(1);
    await withRetry(operation, { sleep });
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it("gives up after the last attempt", async () => {
    const error = new TypeError("Failed to fetch");
    await expect(withRetry(() => Promise.reject(error), { attempts: 2, sleep: async () => undefined })).rejects.toBe(error);
  });
});

describe("mapWithConcurrency", () => {
  it("never exceeds the limit and keeps result order", async () => {
    let active = 0;
    let peak = 0;
    const results = await mapWithConcurrency([30, 10, 20, 5, 15], 2, async (delay, index) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, delay));
      active -= 1;
      return index;
    });
    expect(peak).toBe(2);
    expect(results.map((result) => (result.status === "fulfilled" ? result.value : null))).toEqual([0, 1, 2, 3, 4]);
  });

  it("isolates failures", async () => {
    const results = await mapWithConcurrency([1, 2, 3], 3, async (value) => {
      if (value === 2) throw new Error("boom");
      return value;
    });
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  });
});
