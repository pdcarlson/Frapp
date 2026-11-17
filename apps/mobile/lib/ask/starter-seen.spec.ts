import { describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({ default: {} }));

import { claimAskStarter } from "./starter-seen";

function memory() {
  const kept = new Map<string, string>();
  return {
    kept,
    getItem: vi.fn(async (key: string) => kept.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      kept.set(key, value);
    }),
  };
}

describe("Ask's first-open starter (#4904)", () => {
  it("is shown once per member on this phone", async () => {
    const storage = memory();
    expect(await claimAskStarter("ana", storage)).toBe(true);
    expect(await claimAskStarter("ana", storage)).toBe(false);
    // A second account on the same phone gets its own first open.
    expect(await claimAskStarter("ben", storage)).toBe(true);
  });

  it("is never shown when the phone can't read or can't keep the record", async () => {
    const unreadable = memory();
    unreadable.getItem.mockRejectedValue(new Error("locked"));
    expect(await claimAskStarter("ana", unreadable)).toBe(false);

    const unwritable = memory();
    unwritable.setItem.mockRejectedValue(new Error("full"));
    expect(await claimAskStarter("ana", unwritable)).toBe(false);
  });
});
