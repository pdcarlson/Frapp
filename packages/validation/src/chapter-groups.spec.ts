import { describe, expect, it } from "vitest";
import {
  groupKindOpensChannels,
  majorGroupKey,
  majorSuggestions,
  classStanding,
  groupDisplayName,
  seniorClassYear,
} from "./chapter-groups";

describe("groupKindOpensChannels", () => {
  it("opens channels for groups an officer controls, not ones members set", () => {
    expect(groupKindOpensChannels("manual")).toBe(true);
    expect(groupKindOpensChannels("pledge_class")).toBe(true);
    expect(groupKindOpensChannels("class_year")).toBe(false);
    expect(groupKindOpensChannels("major")).toBe(false);
    expect(groupKindOpensChannels("something_new")).toBe(false);
  });
});

describe("majorGroupKey", () => {
  it("ignores case and runs of whitespace", () => {
    expect(majorGroupKey("  Mechanical\t  Engineering ")).toBe(
      "mechanical engineering",
    );
    expect(majorGroupKey("mechE")).toBe(majorGroupKey("MechE"));
    expect(majorGroupKey(null)).toBe("");
    expect(majorGroupKey("   ")).toBe("");
  });
});

describe("majorSuggestions", () => {
  const majors = [
    "Mechanical Engineering",
    "Music",
    "Computer Science",
    "Materials Engineering",
    "music",
  ];

  it("lists what contains the text, starts-with first", () => {
    expect(majorSuggestions(majors, "eng")).toEqual([
      "Materials Engineering",
      "Mechanical Engineering",
    ]);
    expect(majorSuggestions(majors, "m")).toEqual([
      "Materials Engineering",
      "Mechanical Engineering",
      "Music",
      "Computer Science",
    ]);
  });

  it("offers every major once while the field is empty", () => {
    expect(majorSuggestions(majors, "")).toEqual([
      "Computer Science",
      "Materials Engineering",
      "Mechanical Engineering",
      "Music",
    ]);
  });

  it("offers nothing once the field holds a major exactly, in any case", () => {
    expect(majorSuggestions(majors, "MUSIC ")).toEqual([]);
  });

  it("keeps to the limit", () => {
    expect(majorSuggestions(majors, "", 2)).toHaveLength(2);
  });
});

describe("classStanding (#5786)", () => {
  const fall = new Date("2026-11-20T12:00:00Z");

  it("names this academic year's four classes, seniors graduating next spring", () => {
    expect(seniorClassYear(fall)).toBe(2027);
    expect(classStanding(2027, fall)).toBe("Seniors");
    expect(classStanding(2028, fall)).toBe("Juniors");
    expect(classStanding(2029, fall)).toBe("Sophomores");
    expect(classStanding(2030, fall)).toBe("Freshmen");
  });

  it("gives no standing past senior year, before freshman year, or without a year", () => {
    expect(classStanding(2026, fall)).toBeNull();
    expect(classStanding(2031, fall)).toBeNull();
    expect(classStanding(null, fall)).toBeNull();
    expect(classStanding(2027.5, fall)).toBeNull();
  });

  it("moves every class up on June 1, UTC, with nobody editing anything", () => {
    const may31 = new Date("2027-05-31T23:59:59Z");
    const june1 = new Date("2027-06-01T00:00:00Z");
    expect(classStanding(2027, may31)).toBe("Seniors");
    expect(classStanding(2028, may31)).toBe("Juniors");
    expect(classStanding(2027, june1)).toBeNull();
    expect(classStanding(2028, june1)).toBe("Seniors");
    expect(classStanding(2031, june1)).toBe("Freshmen");
  });
});

describe("groupDisplayName (#5786)", () => {
  const fall = new Date("2026-11-20T12:00:00Z");

  it("puts a class year's standing before its name", () => {
    expect(
      groupDisplayName(
        { kind: "class_year", name: "Class of 2029", class_year: 2029 },
        fall,
      ),
    ).toBe("Sophomores · Class of 2029");
  });

  it("leaves alumni years and every other kind as named", () => {
    expect(
      groupDisplayName(
        { kind: "class_year", name: "Class of 2025", class_year: 2025 },
        fall,
      ),
    ).toBe("Class of 2025");
    expect(
      groupDisplayName(
        { kind: "manual", name: "Seniors", class_year: null },
        fall,
      ),
    ).toBe("Seniors");
  });
});
