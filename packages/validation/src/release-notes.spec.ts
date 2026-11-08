import { describe, expect, it } from "vitest";
import {
  RELEASE_NOTES,
  formatReleaseNoteDate,
  releaseNoteText,
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
