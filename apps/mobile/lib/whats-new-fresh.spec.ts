import { afterEach, describe, expect, it } from "vitest";
import { RELEASE_NOTES } from "@repo/validation";
import {
  WHATS_NEW_SNAPSHOT_STORAGE_KEY,
  resetWhatsNewFreshForTests,
  startWhatsNewFresh,
} from "./whats-new-fresh";

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: async (key: string) => data.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

afterEach(() => resetWhatsNewFreshForTests());

describe("startWhatsNewFresh", () => {
  it("remembers the newest entry on a phone with nothing stored", async () => {
    const storage = memory();
    await startWhatsNewFresh(storage);
    const stored = JSON.parse(storage.data.get(WHATS_NEW_SNAPSHOT_STORAGE_KEY)!);
    expect(stored.date).toBe(RELEASE_NOTES[0]!.date);
    expect(stored.fresh).toEqual([]);
  });

  it("reads once per process", async () => {
    const storage = memory();
    const first = startWhatsNewFresh(storage);
    expect(startWhatsNewFresh(storage)).toBe(first);
    await first;
  });

  it("marks nothing when storage fails", async () => {
    const broken = {
      getItem: async () => {
        throw new Error("no");
      },
      setItem: async () => {
        throw new Error("no");
      },
    };
    await expect(startWhatsNewFresh(broken)).resolves.toBeUndefined();
  });
});
