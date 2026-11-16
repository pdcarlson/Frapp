// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { RELEASE_NOTES, releaseNoteGroups } from "@repo/validation";
import {
  WHATS_NEW_SNAPSHOT_STORAGE_KEY,
  resetWhatsNewFreshForTests,
  startWhatsNewFresh,
} from "./whats-new-fresh";

const newest = RELEASE_NOTES[0]!;
const lines = releaseNoteGroups(newest).flatMap((group) => group.lines);

afterEach(() => {
  resetWhatsNewFreshForTests();
  window.localStorage.clear();
});

describe("startWhatsNewFresh", () => {
  it("marks nothing in a browser with no snapshot, and stores one", () => {
    expect(startWhatsNewFresh()).toEqual([]);
    const stored = JSON.parse(
      window.localStorage.getItem(WHATS_NEW_SNAPSHOT_STORAGE_KEY)!,
    );
    expect(stored).toEqual({ date: newest.date, lines, fresh: [] });
  });

  it("marks the lines this deploy added to the day the last one had", () => {
    window.localStorage.setItem(
      WHATS_NEW_SNAPSHOT_STORAGE_KEY,
      JSON.stringify({ date: newest.date, lines: lines.slice(0, 1), fresh: [] }),
    );
    expect(startWhatsNewFresh()).toEqual(lines.slice(1));
  });

  it("works it out once per page load", () => {
    const first = startWhatsNewFresh();
    window.localStorage.removeItem(WHATS_NEW_SNAPSHOT_STORAGE_KEY);
    expect(startWhatsNewFresh()).toBe(first);
  });
});
