import { describe, expect, it } from "vitest";
import {
  formatGraduationYear,
  formatServiceHours,
  profileIdentityLine,
  profileStatsErrorNote,
  selectPointsBalance,
  sumApprovedServiceMinutes,
} from "./profile-stats";

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

describe("formatServiceHours", () => {
  it("keeps one decimal, and drops it for whole hours", () => {
    expect(formatServiceHours(1110)).toBe("18.5");
    expect(formatServiceHours(120)).toBe("2");
    expect(formatServiceHours(0)).toBe("0");
    expect(formatServiceHours(45)).toBe("0.8");
  });
});

describe("profileStatsErrorNote", () => {
  it("names the read that failed, or both", () => {
    expect(profileStatsErrorNote(false, false)).toBeNull();
    expect(profileStatsErrorNote(true, false)).toBe(
      "Points couldn't load just now.",
    );
    expect(profileStatsErrorNote(false, true)).toBe(
      "Service hours couldn't load just now.",
    );
    expect(profileStatsErrorNote(true, true)).toBe(
      "Points and service hours couldn't load just now.",
    );
  });
});

describe("formatGraduationYear", () => {
  it("renders the two-digit form the reference draws", () => {
    expect(formatGraduationYear(2027)).toBe("'27");
    expect(formatGraduationYear(null)).toBeNull();
  });
});

describe("profileIdentityLine", () => {
  it("joins major, company and year, skipping what is unset", () => {
    expect(
      profileIdentityLine({
        major: "Economics",
        company: "Acme",
        graduationYear: 2027,
      }),
    ).toBe("Economics · Acme · '27");
    expect(
      profileIdentityLine({ major: "  ", company: null, graduationYear: 2027 }),
    ).toBe("'27");
  });

  it("is null when nothing is set", () => {
    expect(
      profileIdentityLine({
        major: undefined,
        company: "",
        graduationYear: null,
      }),
    ).toBeNull();
  });
});
