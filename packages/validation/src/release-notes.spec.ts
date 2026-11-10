import { describe, expect, it } from "vitest";
import {
  RELEASE_NOTES,
  formatReleaseNoteDate,
  releaseNoteText,
  releaseNoteVersion,
  parseReleaseNoteVersion,
  isNewerReleaseNoteVersion,
  decideWhatsNew,
  type ReleaseNote,
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
        // frapp.live/changelog renders these, and landing copy takes no em
        // dashes (spec/ui/landing/README.md § Marketing copy rules).
        expect(line).not.toContain("\u2014");
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

const note = (date: string): ReleaseNote => ({
  date,
  title: `Batch ${date}`,
  changes: ["Something changed."],
});

// Newest first, as RELEASE_NOTES is.
const NOTES = [note("2026-11-09"), note("2026-11-07"), note("2026-11-01")];

const decide = (
  overrides: Partial<Parameters<typeof decideWhatsNew>[0]> = {},
) =>
  decideWhatsNew({
    notes: NOTES,
    seen: null,
    tourDue: false,
    existingInstall: true,
    ...overrides,
  });

const ID = NOTES.map(releaseNoteVersion);

describe("decideWhatsNew", () => {
  it("shows an entry newer than the one this device last saw, and records the newest", () => {
    expect(decide({ seen: ID[1]! })).toEqual({
      show: [NOTES[0]],
      record: ID[0],
    });
  });

  it("shows every entry newer than the marker, newest first, after skipping updates", () => {
    expect(decide({ seen: ID[2]! })).toEqual({
      show: [NOTES[0], NOTES[1]],
      record: ID[0],
    });
  });

  it("never shows an entry again once it is recorded", () => {
    expect(decide({ seen: ID[0]! })).toEqual({ show: [], record: null });
    // A marker from a newer bundle (an update rolled back) is still up to date.
    expect(decide({ seen: "2026-12-01#1" })).toEqual({
      show: [],
      record: null,
    });
  });

  it("shows the same day's entry again once a later release added lines to it", () => {
    const extended = { ...NOTES[0]!, changes: [...NOTES[0]!.changes, "More."] };
    const notes = [extended, NOTES[1]!, NOTES[2]!];
    expect(decide({ notes, seen: ID[0]! })).toEqual({
      show: [extended],
      record: releaseNoteVersion(extended),
    });
  });

  it("shows nothing for a reworded entry, which isn't news", () => {
    const reworded = { ...NOTES[0]!, title: "Reworded", changes: ["Fixed a typo."] };
    expect(decide({ notes: [reworded, NOTES[1]!], seen: ID[0]! })).toEqual({
      show: [],
      record: null,
    });
  });

  it("shows nothing after a rollback to a shorter version of the same day's entry", () => {
    const extended = { ...NOTES[0]!, changes: [...NOTES[0]!.changes, "More."] };
    expect(
      decide({ seen: releaseNoteVersion(extended) }),
    ).toEqual({ show: [], record: null });
  });

  it("leaves out an older entry this device saw longer, when a newer day ships", () => {
    const trimmed = { ...NOTES[1]!, changes: [] as string[] };
    const notes = [NOTES[0]!, { ...trimmed, changes: ["Only one."] }, NOTES[2]!];
    // The device saw the 11-07 entry with 3 lines; it now has 1.
    expect(decide({ notes, seen: "2026-11-07#3" })).toEqual({
      show: [NOTES[0]],
      record: ID[0],
    });
  });

  it("records without showing on a fresh install's first launch", () => {
    expect(decide({ seen: null, existingInstall: false })).toEqual({
      show: [],
      record: ID[0],
    });
  });

  it("records without showing while the first-run tour is due, marker or not", () => {
    expect(decide({ seen: null, tourDue: true })).toEqual({
      show: [],
      record: ID[0],
    });
    expect(decide({ seen: ID[1]!, tourDue: true })).toEqual({
      show: [],
      record: ID[0],
    });
  });

  it("shows only the newest entry to an install from before the marker existed", () => {
    expect(decide({ seen: null, existingInstall: true })).toEqual({
      show: [NOTES[0]],
      record: ID[0],
    });
  });

  it("does nothing with no entries", () => {
    expect(decide({ notes: [] })).toEqual({ show: [], record: null });
  });

  it("reads the real list newest first, so `notes[0]` is the newest", () => {
    const dates = RELEASE_NOTES.map((n) => n.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(new Set(dates).size).toBe(dates.length);
    for (const date of dates) expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
