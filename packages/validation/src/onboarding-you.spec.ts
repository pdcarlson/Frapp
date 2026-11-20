import { describe, expect, it } from "vitest";
import {
  initialNameField,
  needsName,
  typedNameMissing,
  onboardingProfileAnsweredProperties,
} from "./onboarding-you";

describe("needsName", () => {
  it("asks when there is no name, or only the API's stand-in", () => {
    expect(needsName(null)).toBe(true);
    expect(needsName("  ")).toBe(true);
    expect(needsName("Member")).toBe(true);
  });

  it("asks when the name is only the email before the @", () => {
    expect(needsName("pdcarlson06", "pdcarlson06@gmail.com")).toBe(true);
    expect(needsName("PDCarlson06", "pdcarlson06@gmail.com")).toBe(true);
  });

  it("takes a real name, even one that shares a word with the email", () => {
    expect(needsName("Paul Carlson", "paul@rpi.edu")).toBe(false);
    expect(needsName("paul", undefined)).toBe(false);
  });
});

describe("initialNameField", () => {
  it("pre-fills a real name and leaves a stand-in empty", () => {
    expect(initialNameField(" Marcus Ellison ", "m@x.edu")).toBe(
      "Marcus Ellison",
    );
    expect(initialNameField("newbie.one", "newbie.one@example.com")).toBe("");
    expect(initialNameField("Member", null)).toBe("");
  });
});

describe("onboardingProfileAnsweredProperties", () => {
  it("says what came out of the screen, never the name", () => {
    expect(
      onboardingProfileAnsweredProperties({
        hadPhoto: false,
        hasPhoto: true,
        hadName: false,
        nameChanged: true,
      }),
    ).toEqual({ photo: "added", name_step: "added" });
    expect(
      onboardingProfileAnsweredProperties({
        hadPhoto: true,
        hasPhoto: true,
        hadName: true,
        nameChanged: false,
      }),
    ).toEqual({ photo: "had", name_step: "kept" });
  });
});

describe("typedNameMissing", () => {
  it("takes any typed name, even the email's own local part", () => {
    // evan@example.com is stored as "evan"; "Evan" typed is their name.
    expect(typedNameMissing("Evan")).toBe(false);
    expect(typedNameMissing(" evan ")).toBe(false);
  });

  it("refuses nothing typed and the stand-in", () => {
    expect(typedNameMissing("   ")).toBe(true);
    expect(typedNameMissing(null)).toBe(true);
    expect(typedNameMissing("Member")).toBe(true);
  });
});
