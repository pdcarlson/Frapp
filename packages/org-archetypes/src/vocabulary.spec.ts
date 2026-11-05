import { describe, expect, it } from "vitest";
import { memberViewVocabulary, titleCase, vocab } from "./index";

describe("vocab", () => {
  it("falls back to the IFC default when the chapter has no override", () => {
    expect(vocab("pledge", undefined)).toBe("New member");
    expect(vocab("pledge", {})).toBe("New member");
  });

  it("returns the chapter's own override when set", () => {
    expect(vocab("pledge", { vocabulary: { pledge: "Aspirant" } })).toBe(
      "Aspirant",
    );
  });

  it("ignores a blank or non-string override and falls back to the default", () => {
    expect(vocab("pledge", { vocabulary: { pledge: "   " } })).toBe(
      "New member",
    );
    // The member view sends the stored column as it is.
    expect(vocab("pledge", { vocabulary: { pledge: 7 } })).toBe("New member");
    expect(vocab("pledge", { vocabulary: { pledge: null } })).toBe(
      "New member",
    );
  });

  it("trims the chapter's word", () => {
    expect(vocab("recruitment", { vocabulary: { recruitment: " Intake " } })).toBe(
      "Intake",
    );
  });
});

// #351 diff-review finding: the rollover copy's regex assertions are
// case-insensitive, so they alone would not catch a capitalization
// regression — this pins the pure helper's behavior directly.
describe("titleCase", () => {
  it("capitalizes every word, not just the string's first character", () => {
    // The bug this guards: a naive "capitalize only the first char of the
    // whole string" helper leaves "New member" unchanged, since its first
    // character ("N") is already uppercase.
    expect(titleCase("New member")).toBe("New Member");
    expect(titleCase(vocab("pledge", undefined))).toBe("New Member");
  });

  it("leaves an already-fully-capitalized term unchanged", () => {
    expect(titleCase("Aspirant")).toBe("Aspirant");
    expect(titleCase("Pledge Class")).toBe("Pledge Class");
  });

  it("handles an empty string without throwing", () => {
    expect(titleCase("")).toBe("");
  });
});

// The member view carries the raw `vocabulary` column, so the archetype's
// defaults have to be merged in here, as `ChapterConfigService` does for the
// config read. Otherwise a chapter with no stored word loses its /intake.
describe("memberViewVocabulary", () => {
  it("prefers the chapter's stored word", () => {
    const config = memberViewVocabulary({
      org_archetype: "nphc",
      vocabulary: { recruitment: "Induction" },
    });
    expect(vocab("recruitment", config)).toBe("Induction");
  });

  it("falls back to the archetype's word when none is stored", () => {
    expect(
      vocab(
        "recruitment",
        memberViewVocabulary({ org_archetype: "nphc", vocabulary: null }),
      ),
    ).toBe("Intake");
    expect(
      vocab("recruitment", memberViewVocabulary({ org_archetype: null })),
    ).toBe("Rush");
  });

  it("keeps the archetype's word under a blank or non-string stored one", () => {
    // The config PATCH takes any string, so a cleared field is stored as "".
    for (const stored of ["", "   ", null, 7]) {
      expect(
        vocab(
          "recruitment",
          memberViewVocabulary({
            org_archetype: "nphc",
            vocabulary: { recruitment: stored },
          }),
        ),
      ).toBe("Intake");
    }
  });

  it("says nothing until the read answers", () => {
    expect(memberViewVocabulary(undefined)).toBeUndefined();
  });
});

// Web's chat shell and both rush cards name recruitment with this, so a chapter
// sees its own council's word on every surface.
describe("the recruitment word per archetype", () => {
  it.each([
    ["ifc", "Rush"],
    ["npc", "Recruitment"],
    ["nphc", "Intake"],
    ["mgc", "Intake"],
    ["professional", "Recruitment"],
    ["service", "Rush"],
    ["honor", "Induction"],
    ["colony", "Rush"],
  ])("%s says %s", (org_archetype, word) => {
    expect(
      vocab("recruitment", memberViewVocabulary({ org_archetype })),
    ).toBe(word);
  });

  it("reads an unknown archetype as IFC", () => {
    expect(
      vocab("recruitment", memberViewVocabulary({ org_archetype: "guild" })),
    ).toBe("Rush");
  });
});
