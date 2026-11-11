import React, { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  WHATS_NEW_QUIET_STORAGE_KEY,
  WHATS_NEW_SEEN_STORAGE_KEY,
  clearWhatsNewQuiet,
  hasExistingInstallKey,
  markWhatsNewQuiet,
  markWhatsNewRead,
  resetWhatsNewQuietForTests,
  useWhatsNewQuiet,
  readWhatsNewSeen,
  recordWhatsNewSeen,
  resetWhatsNewBootReadForTests,
  startWhatsNewBootRead,
} from "./whats-new";

// A stored `releaseNoteVersion`.
const SEEN = "2026-11-09#1";

describe("hasExistingInstallKey", () => {
  it("counts a chat read cursor or a last channel as a phone that has been used", () => {
    expect(hasExistingInstallKey(["chat:lastSeen:channel-1"])).toBe(true);
    expect(
      hasExistingInstallKey(["frapp.chat.last-channel.user-1.chapter-1"]),
    ).toBe(true);
  });

  it("does not count what a fresh install writes before chat", () => {
    expect(hasExistingInstallKey([])).toBe(false);
    expect(
      hasExistingInstallKey([
        "frapp.mobile.push-primer",
        "frapp.mobile.tour-due",
        WHATS_NEW_SEEN_STORAGE_KEY,
      ]),
    ).toBe(false);
  });
});

describe("startWhatsNewBootRead", () => {
  beforeEach(() => resetWhatsNewBootReadForTests());

  it("reads the keys once per process, so later chat writes can't change the answer", async () => {
    const keys: string[] = [];
    const storage = { getAllKeys: vi.fn(async () => [...keys]) };
    expect(await startWhatsNewBootRead(storage)).toBe(false);
    keys.push("chat:lastSeen:channel-1");
    expect(await startWhatsNewBootRead(storage)).toBe(false);
    expect(storage.getAllKeys).toHaveBeenCalledTimes(1);
  });

  it("counts a failed read as a fresh install", async () => {
    const storage = {
      getAllKeys: vi.fn(async () => {
        throw new Error("disk");
      }),
    };
    expect(await startWhatsNewBootRead(storage)).toBe(false);
  });
});

describe("the seen marker", () => {
  function memoryStorage() {
    const values = new Map<string, string>();
    return {
      values,
      getItem: vi.fn(async (key: string) => values.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        values.set(key, value);
      }),
    };
  }

  it("round-trips the date under its own key", async () => {
    const storage = memoryStorage();
    expect(await readWhatsNewSeen(storage)).toBeNull();
    await recordWhatsNewSeen(SEEN, storage);
    expect(storage.values.get(WHATS_NEW_SEEN_STORAGE_KEY)).toBe(SEEN);
    expect(await readWhatsNewSeen(storage)).toBe(SEEN);
  });

  it("never throws on a storage failure", async () => {
    const broken = {
      getItem: vi.fn(async () => {
        throw new Error("disk");
      }),
      setItem: vi.fn(async () => {
        throw new Error("disk");
      }),
    };
    await expect(readWhatsNewSeen(broken)).resolves.toBeNull();
    await expect(recordWhatsNewSeen("2026-11-09", broken)).resolves.toBe(
      undefined,
    );
  });
});

describe("the quiet mark (#4043)", () => {
  const storage = vi.mocked(AsyncStorage);
  let values: Map<string, string>;

  beforeEach(() => {
    resetWhatsNewQuietForTests();
    values = new Map();
    storage.getItem.mockImplementation(async (key: string) => values.get(key) ?? null);
    storage.setItem.mockImplementation(async (key: string, value: string) => {
      values.set(key, value);
    });
  });

  function Probe() {
    return <>{useWhatsNewQuiet() ? "quiet" : "none"}</>;
  }

  it("records the entry another device showed, and keeps the mark until What's new is read here", async () => {
    await markWhatsNewQuiet(SEEN);
    expect(values.get(WHATS_NEW_SEEN_STORAGE_KEY)).toBe(SEEN);
    expect(values.get(WHATS_NEW_QUIET_STORAGE_KEY)).toBe("quiet");

    await markWhatsNewRead(SEEN);
    expect(values.get(WHATS_NEW_SEEN_STORAGE_KEY)).toBe(SEEN);
    expect(values.get(WHATS_NEW_QUIET_STORAGE_KEY)).toBe("none");
  });

  it("reads a mark left by an earlier launch back", async () => {
    values.set(WHATS_NEW_QUIET_STORAGE_KEY, "quiet");
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<Probe />);
    });
    expect(tree.toJSON()).toBe("quiet");
    await act(async () => clearWhatsNewQuiet());
    expect(tree.toJSON()).toBe("none");
  });
});
