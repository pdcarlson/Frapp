import { afterEach, describe, expect, it } from "vitest";
import {
  calendarCreateStart,
  readHiddenKinds,
  writeHiddenKinds,
} from "./events-view";

describe("colour key memory (#5560)", () => {
  afterEach(() => window.localStorage.clear());

  it("reads back the kinds switched off, for that user only", () => {
    writeHiddenKinds("user-1", new Set(["birthdays"]));
    expect(readHiddenKinds("user-1")).toEqual(new Set(["birthdays"]));
    expect(readHiddenKinds("user-2")).toBeNull();
  });

  it("ignores the old calendar layer toggles' choice", () => {
    window.localStorage.setItem(
      "frapp.events.calendar-layers.user-1",
      '{"hidden":["mine"]}',
    );
    expect(readHiddenKinds("user-1")).toBeNull();
  });

  it("has nothing to read before the viewer is known", () => {
    expect(readHiddenKinds(null)).toBeNull();
  });
});

describe("calendarCreateStart", () => {
  const day = new Date(2026, 10, 13, 9, 41);

  it("starts at 6 PM when no hour was pressed", () => {
    expect(calendarCreateStart(day)).toEqual(new Date(2026, 10, 13, 18));
  });

  it("starts an hour's event at that hour", () => {
    expect(calendarCreateStart(day, 15)).toEqual(new Date(2026, 10, 13, 15));
  });
});
