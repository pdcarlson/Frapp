import { describe, expect, it, vi } from "vitest";
import { createBatcher } from "./batcher";

const tick = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

describe("createBatcher", () => {
  it("serves calls made together with one request, each getting its own answer", async () => {
    const run = vi.fn(async (items: number[]) => items.map((n) => n * 10));
    const batcher = createBatcher(run, { waitMs: 10 });
    const answers = await Promise.all([1, 2, 3].map((n) => batcher.add(n)));
    expect(answers).toEqual([10, 20, 30]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith([1, 2, 3]);
  });

  it("splits at `max` and sends a full batch without waiting", async () => {
    const run = vi.fn(async (items: number[]) => items);
    const batcher = createBatcher(run, { max: 2, waitMs: 1000 });
    const first = Promise.all([batcher.add(1), batcher.add(2)]);
    await expect(first).resolves.toEqual([1, 2]);
    expect(run).toHaveBeenCalledWith([1, 2]);
  });

  it("rejects every caller in a batch that fails", async () => {
    const batcher = createBatcher<number, number>(
      async () => {
        throw new Error("429");
      },
      { waitMs: 5 },
    );
    const results = await Promise.allSettled([batcher.add(1), batcher.add(2)]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
  });

  it("starts a new batch for calls after the last one went out", async () => {
    const run = vi.fn(async (items: number[]) => items);
    const batcher = createBatcher(run, { waitMs: 5 });
    await batcher.add(1);
    await tick();
    await batcher.add(2);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
