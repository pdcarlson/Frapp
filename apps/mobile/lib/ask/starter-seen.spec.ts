import { describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({ default: {} }));

import { askStarterStore } from "./starter-seen";

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

describe("where the phone keeps Ask's first-open starter (#4904)", () => {
  it("keeps it per member, with whether Frapp could act", async () => {
    const storage = memory();
    const store = askStarterStore(storage);
    expect(await store.read("ana")).toBeNull();
    expect(await store.write("ana", "ask")).toBe(true);
    expect(await store.read("ana")).toBe("ask");
    // A second account on the same phone gets its own first open.
    expect(await store.read("ben")).toBeNull();
    // Anything else on the key is no record.
    storage.kept.set("frapp.mobile.ask-starter-seen:cy", "1");
    expect(await store.read("cy")).toBeNull();
  });

  it("answers, never throws, when the phone can't read or keep it", async () => {
    const broken = memory();
    broken.getItem.mockRejectedValue(new Error("locked"));
    broken.setItem.mockRejectedValue(new Error("full"));
    const store = askStarterStore(broken);
    expect(await store.read("ana")).toBeUndefined();
    expect(await store.write("ana", "act")).toBe(false);
  });
});
