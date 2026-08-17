import { describe, expect, it } from "vitest";
import {
  formatGraduationYear,
  formatHours,
  selectPointsBalance,
  selectViewerProfile,
  sumApprovedServiceMinutes,
} from "./profile";

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
      }),
    ).toEqual({
      displayName: "Paul Carlson",
      initials: "PC",
      email: "pdcarlson@rpi.edu",
      graduationYear: 2027,
      currentCity: "Troy",
      currentCompany: null,
      // `''` is absent, not a value — `bio` is nullable and both mean "unset".
      bio: null,
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

describe("selectPointsBalance", () => {
  it("reads the balance out of the points summary", () => {
    expect(selectPointsBalance({ balance: 1240, transactions: [] })).toBe(1240);
  });

  // A real zero and "not loaded" must not render the same, or the screen states
  // a fact it does not have.
  it("distinguishes a real zero from an absent payload", () => {
    expect(selectPointsBalance({ balance: 0, transactions: [] })).toBe(0);
    expect(selectPointsBalance(undefined)).toBeNull();
    expect(selectPointsBalance({ transactions: [] })).toBeNull();
  });

  it("rejects a non-finite balance rather than propagating NaN", () => {
    expect(selectPointsBalance({ balance: Number.NaN })).toBeNull();
  });
});

describe("sumApprovedServiceMinutes", () => {
  // Approved only, matching `get_service_leaderboard`: pending time is not yet
  // credited, and banking it here would overstate the member's total.
  it("counts approved entries and ignores pending and rejected ones", () => {
    expect(
      sumApprovedServiceMinutes([
        { status: "APPROVED", duration_minutes: 150 },
        { status: "PENDING", duration_minutes: 999 },
        { status: "REJECTED", duration_minutes: 999 },
        { status: "APPROVED", duration_minutes: 960 },
      ]),
    ).toBe(1110);
  });

  // Same distinction `selectPointsBalance` makes: a member with no entries has
  // zero minutes, but "not loaded" is not zero and must not render as it.
  it("distinguishes an empty history from an absent payload", () => {
    expect(sumApprovedServiceMinutes([])).toBe(0);
    expect(sumApprovedServiceMinutes(undefined)).toBeNull();
    expect(sumApprovedServiceMinutes(null)).toBeNull();
  });

  it("skips a row whose duration is missing rather than adding NaN", () => {
    expect(
      sumApprovedServiceMinutes([
        { status: "APPROVED" },
        { status: "APPROVED", duration_minutes: 60 },
      ]),
    ).toBe(60);
  });
});

describe("formatHours", () => {
  it("keeps one decimal, and drops it for whole hours", () => {
    expect(formatHours(1110)).toBe("18.5");
    expect(formatHours(120)).toBe("2");
    expect(formatHours(0)).toBe("0");
    expect(formatHours(45)).toBe("0.8");
  });
});

describe("formatGraduationYear", () => {
  it("renders the two-digit form the reference draws", () => {
    expect(formatGraduationYear(2027)).toBe("'27");
    expect(formatGraduationYear(null)).toBeNull();
  });
});
