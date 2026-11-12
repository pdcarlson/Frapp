import { describe, expect, it } from "vitest";
import { selectViewerProfile } from "./profile";

describe("selectViewerProfile", () => {
  it("narrows the fields s15 actually draws", () => {
    expect(
      selectViewerProfile({
        id: "u-1",
        display_name: "Paul Carlson",
        email: "pdcarlson@rpi.edu",
        graduation_year: 2027,
        current_city: "Troy",
        current_company: null,
        bio: "",
        avatar_url: "https://storage.example/signed/photo",
      }),
    ).toEqual({
      displayName: "Paul Carlson",
      initials: "PC",
      email: "pdcarlson@rpi.edu",
      phone: null,
      graduationYear: 2027,
      major: null,
      currentCity: "Troy",
      currentCompany: null,
      // `''` is absent, not a value — `bio` is nullable and both mean "unset".
      bio: null,
      photoUrl: "https://storage.example/signed/photo",
    });
  });

  it("returns null before the first payload", () => {
    expect(selectViewerProfile(undefined)).toBeNull();
    expect(selectViewerProfile(null)).toBeNull();
    expect(selectViewerProfile([])).toBeNull();
  });

  // `users.display_name` is `NOT NULL DEFAULT ''`, so an empty string is the
  // real "no name set" case and the avatar must not render blank.
  it("falls back to a placeholder initial for an unset name", () => {
    const profile = selectViewerProfile({ display_name: "" });
    expect(profile?.displayName).toBeNull();
    expect(profile?.initials).toBe("?");
  });

  // Delegates to `lib/chat/display-name.ts` so one person's avatar cannot read
  // differently in the directory than it does in chat.
  it("uses the same initials rule as the chat avatar", () => {
    expect(selectViewerProfile({ display_name: "Ada B. Lovelace" })?.initials).toBe(
      "AB",
    );
    expect(selectViewerProfile({ display_name: "Prince" })?.initials).toBe("PR");
  });
});
