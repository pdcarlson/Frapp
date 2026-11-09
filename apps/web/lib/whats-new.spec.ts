// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { RELEASE_NOTES, releaseNoteVersion } from "@repo/validation";
import {
  WHATS_NEW_SEEN_STORAGE_KEY,
  accountPredatesNote,
  markWhatsNewSeen,
  readWhatsNewSeen,
  skipWhatsNew,
} from "./whats-new";

const NOTE = { date: "2026-11-09", title: "Batch", changes: ["One."] };

describe("accountPredatesNote", () => {
  it("counts an account made before the entry's day as here before it", () => {
    expect(accountPredatesNote("2026-11-08T23:59:59.000Z", NOTE)).toBe(true);
    expect(accountPredatesNote("2025-01-01T00:00:00.000Z", NOTE)).toBe(true);
  });

  it("treats an account made on the entry's day or later as new", () => {
    expect(accountPredatesNote("2026-11-09T00:00:00.000Z", NOTE)).toBe(false);
    expect(accountPredatesNote("2026-12-01T10:00:00.000Z", NOTE)).toBe(false);
  });

  it("treats an account of unknown age as new", () => {
    expect(accountPredatesNote(undefined, NOTE)).toBe(false);
    expect(accountPredatesNote(null, NOTE)).toBe(false);
    expect(accountPredatesNote("not a date", NOTE)).toBe(false);
  });
});

describe("the seen marker", () => {
  beforeEach(() => window.localStorage.clear());

  it("reads nothing from a browser that never showed an entry", () => {
    expect(readWhatsNewSeen()).toBeNull();
  });

  it("records the newest entry once the notes are seen", () => {
    markWhatsNewSeen();
    expect(window.localStorage.getItem(WHATS_NEW_SEEN_STORAGE_KEY)).toBe(
      releaseNoteVersion(RELEASE_NOTES[0]!),
    );
  });

  it("records a skipped version as given", () => {
    skipWhatsNew("2026-11-09#3");
    expect(readWhatsNewSeen()).toBe("2026-11-09#3");
  });
});
