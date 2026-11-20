import { describe, expect, it } from "vitest";
import { DISPLAY_NAME_MAX_LENGTH } from "@repo/validation";
import { profileSaveBody, type ProfileFields } from "./profile-save-body";

const SAVED: ProfileFields = {
  display_name: "Ann Lee",
  phone: "(518) 555-0142",
  major: "Economics",
  bio: "Rush chair.",
  graduation_year: 2027,
  current_city: null,
  current_company: null,
  birthday_month: 3,
  birthday_day: 4,
  birthday_year: 2004,
  birthday_visibility: "nobody",
};

describe("profileSaveBody", () => {
  it("sends nothing when nothing changed", () => {
    expect(profileSaveBody(SAVED, { ...SAVED })).toEqual({});
  });

  // A name copied from a sign-in provider before the 100-character limit, or
  // a bio from before its cap, must not refuse an unrelated edit.
  it("leaves out a stored value past today's limit when only the phone changed", () => {
    const longName = "N".repeat(DISPLAY_NAME_MAX_LENGTH + 20);
    const saved = { ...SAVED, display_name: longName };
    expect(profileSaveBody(saved, { ...saved, phone: "518 555 0199" })).toEqual(
      { phone: "+15185550199" },
    );
  });

  // #5798: the field shows the stored number formatted; that is no change.
  it("sends no phone when only its formatting differs from what is stored", () => {
    const saved = { ...SAVED, phone: "+15185550142" };
    expect(
      profileSaveBody(saved, { ...saved, phone: "(518) 555-0142" }),
    ).toEqual({});
  });

  it("sends a changed field trimmed, and a stray space is no change", () => {
    expect(
      profileSaveBody(SAVED, {
        ...SAVED,
        display_name: " Ann Lee ",
        major: "  Economics and Math ",
      }),
    ).toEqual({ major: "Economics and Math" });
  });

  it("clears a text field with an empty string and the year with null", () => {
    expect(
      profileSaveBody(SAVED, { ...SAVED, bio: "", graduation_year: null }),
    ).toEqual({ bio: "", graduation_year: null });
  });

  it("reads an unset field and an empty one as the same", () => {
    expect(profileSaveBody(SAVED, { ...SAVED, current_city: "" })).toEqual({});
  });

  it("sends the whole birthday when only who can see it changed", () => {
    expect(
      profileSaveBody(SAVED, { ...SAVED, birthday_visibility: "chapter" }),
    ).toEqual({
      birthday_month: 3,
      birthday_day: 4,
      birthday_year: 2004,
      birthday_visibility: "chapter",
    });
  });

  it("drops the year with the month when the birthday is cleared", () => {
    expect(
      profileSaveBody(SAVED, {
        ...SAVED,
        birthday_month: null,
        birthday_day: null,
      }),
    ).toEqual({
      birthday_month: null,
      birthday_day: null,
      birthday_year: null,
      birthday_visibility: "nobody",
    });
  });
});
