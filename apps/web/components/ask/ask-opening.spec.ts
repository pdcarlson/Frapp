import { describe, expect, it, vi } from "vitest";
import { askStarterStore } from "./ask-opening";

describe("where this browser keeps Ask's first-open starter (#4904)", () => {
  it("answers, never throws, when site data is blocked", async () => {
    // Blocked site data throws on reaching `localStorage` at all.
    const store = askStarterStore(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    await expect(store.read("me")).resolves.toBeUndefined();
    await expect(store.write("me", "ask")).resolves.toBe(false);
  });

  it("keeps it per member, with whether Frapp could act", async () => {
    const kept = new Map<string, string>();
    const store = askStarterStore(() => ({
      getItem: vi.fn((key: string) => kept.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => void kept.set(key, value)),
    }));
    await expect(store.read("me")).resolves.toBeNull();
    await store.write("me", "act");
    await expect(store.read("me")).resolves.toBe("act");
    await expect(store.read("you")).resolves.toBeNull();
  });
});
