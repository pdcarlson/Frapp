import { describe, expect, it } from "vitest";
import {
  applyEdit,
  rebaseEdits,
  draftFromProfile,
  GRADUATION_YEAR_MESSAGE,
  hasChanges,
  NAME_REQUIRED_MESSAGE,
  profilePatch,
  type ProfileDraft,
} from "./edit-profile";
import type { ViewerProfile } from "./profile";

/** #3387. s15's Edit sheet: what it opens on, and what a save sends. */

const PROFILE: ViewerProfile = {
  displayName: "Alex Rivera",
  initials: "AR",
  email: "alex@example.test",
  graduationYear: 2027,
  currentCity: "Troy, NY",
  currentCompany: null,
  bio: "CS, intramural soccer.",
  photoUrl: null,
};

const ORIGINAL = draftFromProfile(PROFILE);
const edited = (changes: Partial<ProfileDraft>) => ({
  ...ORIGINAL,
  ...changes,
});

describe("draftFromProfile (#3387)", () => {
  it("opens on the profile as it stands, with blanks for unset fields", () => {
    expect(ORIGINAL).toEqual({
      displayName: "Alex Rivera",
      bio: "CS, intramural soccer.",
      graduationYear: "2027",
      city: "Troy, NY",
      company: "",
    });
  });

  it("opens on blanks before the profile has loaded", () => {
    expect(draftFromProfile(null)).toEqual({
      displayName: "",
      bio: "",
      graduationYear: "",
      city: "",
      company: "",
    });
  });
});

describe("profilePatch (#3387)", () => {
  it("sends nothing when nothing changed", () => {
    const result = profilePatch(ORIGINAL, ORIGINAL);
    expect(result).toEqual({ ok: true, patch: {} });
    expect(hasChanges(result.ok ? result.patch : {})).toBe(false);
  });

  it("sends only the fields that changed, trimmed", () => {
    expect(
      profilePatch(
        ORIGINAL,
        edited({ company: "  Acme  ", city: "Troy, NY " }),
      ),
    ).toEqual({ ok: true, patch: { current_company: "Acme" } });
  });

  it("refuses a blank name, spaces included", () => {
    expect(profilePatch(ORIGINAL, edited({ displayName: "   " }))).toEqual({
      ok: false,
      field: "displayName",
      message: NAME_REQUIRED_MESSAGE,
    });
  });

  it("clears the graduation year when it is emptied", () => {
    expect(profilePatch(ORIGINAL, edited({ graduationYear: "" }))).toEqual({
      ok: true,
      patch: { graduation_year: null },
    });
  });

  it("sends a new graduation year as a number", () => {
    expect(profilePatch(ORIGINAL, edited({ graduationYear: "2028" }))).toEqual({
      ok: true,
      patch: { graduation_year: 2028 },
    });
  });

  it.each(["20", "1899", "2101", "20.5", "abcd", "2O27"])(
    "refuses %s as a graduation year, before any request",
    (year) => {
      expect(profilePatch(ORIGINAL, edited({ graduationYear: year }))).toEqual({
        ok: false,
        field: "graduationYear",
        message: GRADUATION_YEAR_MESSAGE,
      });
    },
  );

  it("lets bio, city and company be cleared", () => {
    expect(profilePatch(ORIGINAL, edited({ bio: "", city: "  " }))).toEqual({
      ok: true,
      patch: { bio: "", current_city: "" },
    });
  });
});

describe("applyEdit and rebaseEdits (#3387)", () => {
  const ORIGINAL = {
    displayName: "Alex Rivera",
    bio: "",
    graduationYear: "2027",
    city: "Troy, NY",
    company: "",
  };
  const MOVED = { ...ORIGINAL, city: "Albany, NY", company: "Set elsewhere" };

  it("drops a field typed to the profile's value", () => {
    let edits = applyEdit(null, ORIGINAL, "city", "Troy, NYx");
    expect(edits).toEqual({ city: "Troy, NYx" });
    edits = applyEdit(edits, ORIGINAL, "city", "Troy, NY");
    expect(edits).toEqual({});
  });

  it("keeps a real change through a refetch", () => {
    const edits = applyEdit(null, ORIGINAL, "city", "Boston");

    expect(rebaseEdits(edits, ORIGINAL, MOVED)).toEqual({ city: "Boston" });
  });

  it("lets a field that held only spaces follow the new profile", () => {
    const edits = applyEdit(null, ORIGINAL, "city", "Troy, NY ");

    expect(rebaseEdits(edits, ORIGINAL, MOVED)).toEqual({});
  });

  it("keeps spaces as typed in a field whose profile value didn't move", () => {
    const edits = applyEdit(null, ORIGINAL, "city", "Troy, NY ");
    const bioMoved = { ...ORIGINAL, bio: "Changed elsewhere" };

    expect(rebaseEdits(edits, ORIGINAL, bioMoved)).toEqual({
      city: "Troy, NY ",
    });
  });

  it("drops a field the refetch brought to the typed value", () => {
    const edits = applyEdit(null, ORIGINAL, "city", "Albany, NY");

    expect(rebaseEdits(edits, ORIGINAL, MOVED)).toEqual({});
  });

  it("re-bases on each refetch, so a typed-back old value is a change", () => {
    // Typed "Troy, N" over Troy, the profile moved to Albany, then "Y".
    let edits = applyEdit(null, ORIGINAL, "city", "Troy, N");
    edits = rebaseEdits(edits, ORIGINAL, MOVED)!;
    edits = applyEdit(edits, MOVED, "city", "Troy, NY");

    expect(edits).toEqual({ city: "Troy, NY" });
  });

  it("keeps no edits as no edits", () => {
    expect(rebaseEdits(null, ORIGINAL, MOVED)).toBeNull();
  });
});
