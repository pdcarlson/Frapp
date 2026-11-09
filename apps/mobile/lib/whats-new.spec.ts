import { beforeEach, describe, expect, it, vi } from "vitest";
import { RELEASE_NOTES, type ReleaseNote } from "@repo/validation";
import {
  WHATS_NEW_SEEN_STORAGE_KEY,
  decideWhatsNew,
  hasExistingInstallKey,
  readWhatsNewSeen,
  recordWhatsNewSeen,
  releaseNoteId,
  resetWhatsNewBootReadForTests,
  startWhatsNewBootRead,
} from "./whats-new";

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

const ID = NOTES.map(releaseNoteId);

describe("releaseNoteId", () => {
  it("is the date plus a fingerprint that changes when a line is added", () => {
    expect(ID[0]).toMatch(/^2026-11-09#[0-9a-z]+$/);
    const extended = { ...NOTES[0]!, changes: [...NOTES[0]!.changes, "More."] };
    expect(releaseNoteId(extended)).not.toBe(ID[0]);
    expect(releaseNoteId({ ...NOTES[0]! })).toBe(ID[0]);
  });
});

describe("decideWhatsNew", () => {
  it("shows an entry newer than the one this phone last saw, and records the newest", () => {
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
    expect(decide({ seen: "2026-12-01#abc" })).toEqual({
      show: [],
      record: null,
    });
  });

  it("shows the same day's entry again once a later release added lines to it", () => {
    const extended = { ...NOTES[0]!, changes: [...NOTES[0]!.changes, "More."] };
    const notes = [extended, NOTES[1]!, NOTES[2]!];
    expect(decide({ notes, seen: ID[0]! })).toEqual({
      show: [extended],
      record: releaseNoteId(extended),
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
    await recordWhatsNewSeen(ID[0]!, storage);
    expect(storage.values.get(WHATS_NEW_SEEN_STORAGE_KEY)).toBe(ID[0]);
    expect(await readWhatsNewSeen(storage)).toBe(ID[0]);
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
