import { describe, expect, it } from "vitest";
import {
  RELEASE_NOTES,
  formatReleaseNoteDate,
  releaseNoteText,
  releaseNoteVersion,
  parseReleaseNoteVersion,
  isNewerReleaseNoteVersion,
} from "./release-notes";

// Pictographic emoji, the product's "no emojis in the UI" rule.
const EMOJI = /\p{Extended_Pictographic}/u;
// Leaks members should never read: issue/PR numbers, versions, Signet.
const INTERNALS = /#\d|\bv?\d+\.\d+\.\d+\b|signet|\bPR\b|\bOTA\b|\bAPI\b/i;

describe("RELEASE_NOTES", () => {
  it("is newest first, one entry per day", () => {
    const dates = RELEASE_NOTES.map((note) => note.date);
    expect(dates).toEqual([...new Set(dates)].sort().reverse());
  });

  it.each(RELEASE_NOTES.map((note) => [note.date, note] as const))(
    "%s reads like a note to members",
    (_date, note) => {
      expect(note.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(formatReleaseNoteDate(note.date)).not.toBe(note.date);
      expect(note.title.trim()).not.toBe("");
      expect(note.changes.length).toBeGreaterThan(0);
      for (const line of [note.title, ...note.changes]) {
        expect(line).not.toMatch(EMOJI);
        expect(line).not.toMatch(INTERNALS);
      }
    },
  );
});

describe("formatReleaseNoteDate", () => {
  it("writes the month out and drops the leading zero", () => {
    expect(formatReleaseNoteDate("2026-11-07")).toBe("November 7, 2026");
    expect(formatReleaseNoteDate("2027-01-31")).toBe("January 31, 2027");
  });

  it("returns anything it can't read unchanged", () => {
    expect(formatReleaseNoteDate("soon")).toBe("soon");
    expect(formatReleaseNoteDate("2026-13-01")).toBe("2026-13-01");
  });
});

describe("releaseNoteText", () => {
  it("is a header, the title, then one dash line per change", () => {
    expect(
      releaseNoteText({
        date: "2026-11-07",
        title: "A title",
        changes: ["One.", "Two."],
      }),
    ).toBe(
      "What's new in Frapp (November 7, 2026)\n\nA title\n\n- One.\n- Two.",
    );
  });
});

describe("releaseNoteVersion", () => {
  const note = { date: "2026-11-09", title: "A title", changes: ["One.", "Two."] };

  it("is the date and the number of lines", () => {
    expect(releaseNoteVersion(note)).toBe("2026-11-09#2");
  });

  it("moves when lines are added, not when one is reworded", () => {
    expect(releaseNoteVersion({ ...note, changes: [...note.changes, "Three."] })).toBe("2026-11-09#3");
    expect(releaseNoteVersion({ ...note, title: "Another", changes: ["Uno.", "Dos."] })).toBe("2026-11-09#2");
  });
});

describe("parseReleaseNoteVersion / isNewerReleaseNoteVersion", () => {
  it("reads a version back, and an unreadable count as 0", () => {
    expect(parseReleaseNoteVersion("2026-11-09#8")).toEqual({ date: "2026-11-09", lines: 8 });
    expect(parseReleaseNoteVersion("2026-11-09")).toEqual({ date: "2026-11-09", lines: 0 });
  });

  it("is news for a later day, or the same day with more lines, and nothing else", () => {
    const seen = { date: "2026-11-09", lines: 8 };
    expect(isNewerReleaseNoteVersion({ date: "2026-11-10", lines: 1 }, seen)).toBe(true);
    expect(isNewerReleaseNoteVersion({ date: "2026-11-09", lines: 9 }, seen)).toBe(true);
    expect(isNewerReleaseNoteVersion({ date: "2026-11-09", lines: 8 }, seen)).toBe(false);
    expect(isNewerReleaseNoteVersion({ date: "2026-11-09", lines: 7 }, seen)).toBe(false);
    expect(isNewerReleaseNoteVersion({ date: "2026-11-08", lines: 20 }, seen)).toBe(false);
  });
});
