import { describe, expect, it } from "vitest";
import {
  groupKindOpensChannels,
  majorGroupKey,
  majorSuggestions,
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
