/** @vitest-environment jsdom */
import React, { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it } from "vitest";
import { RELEASE_NOTES, releaseNoteGroups } from "@repo/validation";
import {
  WHATS_NEW_SNAPSHOT_STORAGE_KEY,
  resetWhatsNewFreshForTests,
  startWhatsNewFresh,
  useFreshReleaseLines,
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

  it("hands the lines this update added to the notes", async () => {
    const newest = RELEASE_NOTES[0]!;
    const lines = releaseNoteGroups(newest).flatMap((group) => group.lines);
    const storage = memory({
      [WHATS_NEW_SNAPSHOT_STORAGE_KEY]: JSON.stringify({
        date: newest.date,
        lines: lines.slice(0, 1),
        fresh: [],
      }),
    });
    const seen: (readonly string[])[] = [];
    let tree!: ReactTestRenderer;
    function Probe() {
      seen.push(useFreshReleaseLines());
      return null;
    }
    act(() => {
      tree = create(<Probe />);
    });
    await act(async () => {
      await startWhatsNewFresh(storage);
    });
    expect(seen.at(-1)).toEqual(lines.slice(1));
    tree.unmount();
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
