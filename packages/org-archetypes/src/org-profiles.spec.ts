import { describe, expect, it } from "vitest";
import {
  orgHidesGreekLetters,
  orgHidingGreekLettersIn,
  orgMarkFieldsFor,
} from "./org-profiles";

describe("orgHidingGreekLettersIn", () => {
  it.each([
    "Phi Gamma Delta",
    "phi  gamma DELTA",
    "Phi Gamma Delta Tau Nu",
    "Tau Nu Chapter of Phi Gamma Delta",
    "Phi Gamma Delta (RPI)",
    "FIJI",
    "FIJI at RPI",
  ])("finds the letter-hiding organization in %j", (name) => {
    expect(orgHidingGreekLettersIn(name)).toBe("Phi Gamma Delta");
  });

  it.each([
    null,
    undefined,
    "",
    "Sigma Nu",
    "Phi Delta Theta",
    "Phi Gamma",
    "Gamma Delta",
    "Fijian Student Association",
    // The short name counts only as FIJI's chapters write it.
    "Fiji Student Association",
    "fiji at RPI",
  ])("finds none in %j", (name) => {
    expect(orgHidingGreekLettersIn(name)).toBeUndefined();
  });

  it("is looser than the exact organization lookup", () => {
    expect(orgHidesGreekLetters("Phi Gamma Delta Tau Nu")).toBe(false);
    expect(orgHidingGreekLettersIn("Phi Gamma Delta Tau Nu")).toBe(
      "Phi Gamma Delta",
    );
  });
});

describe("orgMarkFieldsFor", () => {
  const blank = { shortName: "", showGreekLetters: true };

  it("fills an empty short name and turns FIJI's letters off", () => {
    expect(orgMarkFieldsFor("Phi Gamma Delta", "", blank)).toEqual({
      shortName: "FIJI",
      showGreekLetters: false,
    });
  });

  it("never replaces a short name the founder typed", () => {
    expect(
      orgMarkFieldsFor("Phi Gamma Delta", "", {
        shortName: "Phi Gam",
        showGreekLetters: true,
      }),
    ).toEqual({ shortName: "Phi Gam", showGreekLetters: false });
  });

  it("keeps FIJI's fields while the name still names FIJI", () => {
    const fiji = { shortName: "FIJI", showGreekLetters: false };
    expect(
      orgMarkFieldsFor("Phi Gamma Delta Tau Nu", "Phi Gamma Delta", fiji),
    ).toEqual(fiji);
  });

  it("undoes FIJI's fields when the name moves to another organization", () => {
    const fiji = { shortName: "FIJI", showGreekLetters: false };
    // Typing passes through names that match nothing on the way.
    const midway = orgMarkFieldsFor("Phi Gamma Delt", "Phi Gamma Delta", fiji);
    expect(midway).toEqual({ shortName: "", showGreekLetters: true });
    expect(
      orgMarkFieldsFor("Phi Delta Theta", "Phi Gamma Delt", midway),
    ).toEqual({ shortName: "", showGreekLetters: true });
    // Straight from one organization to another, as a directory pick does.
    expect(orgMarkFieldsFor("Sigma Nu", "Phi Gamma Delta", fiji)).toEqual({
      shortName: "",
      showGreekLetters: true,
    });
  });

  it("keeps a typed short name when leaving FIJI", () => {
    expect(
      orgMarkFieldsFor("Sigma Nu", "Phi Gamma Delta", {
        shortName: "Phi Gam",
        showGreekLetters: false,
      }),
    ).toEqual({ shortName: "Phi Gam", showGreekLetters: true });
  });

  it("leaves an organization without a mark profile alone", () => {
    const fields = { shortName: "Sig Nu", showGreekLetters: false };
    expect(orgMarkFieldsFor("Sigma Nu", "", fields)).toEqual(fields);
  });
});
