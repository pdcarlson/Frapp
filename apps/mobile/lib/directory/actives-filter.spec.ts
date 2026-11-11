import { describe, expect, it } from "vitest";
import {
  countActivesFilters,
  effectiveActivesFilter,
  filterActives,
  graduationYearOptions,
  hasRoleQuery,
  NO_ACTIVES_FILTER,
  parseFilterRoles,
  searchFilterRoles,
} from "./actives-filter";

const ROWS = [
  {
    user_id: "u-1",
    role_ids: ["r-1", "r-2"],
    graduation_year: 2027,
    pledge_class_id: "pc-a",
    has_completed_onboarding: true,
  },
  {
    user_id: "u-2",
    role_ids: ["r-1"],
    graduation_year: 2028,
    pledge_class_id: null,
    has_completed_onboarding: false,
  },
  { user_id: "u-3", role_ids: "not-an-array", graduation_year: null },
];

const ids = (rows: Record<string, unknown>[]) => rows.map((r) => r.user_id);

describe("filterActives (#3971)", () => {
  it("keeps everyone with no filter set", () => {
    expect(ids(filterActives(ROWS, NO_ACTIVES_FILTER))).toEqual([
      "u-1",
      "u-2",
      "u-3",
    ]);
  });

  it("narrows by role held, year, class and status, together", () => {
    const by = (patch: object) =>
      ids(filterActives(ROWS, { ...NO_ACTIVES_FILTER, ...patch }));
    expect(by({ roleId: "r-2" })).toEqual(["u-1"]);
    expect(by({ roleId: "r-1" })).toEqual(["u-1", "u-2"]);
    expect(by({ graduationYear: 2028 })).toEqual(["u-2"]);
    expect(by({ pledgeClassId: "pc-a" })).toEqual(["u-1"]);
    // Web's words: Active is onboarded, Pending is not (a missing flag too).
    expect(by({ status: "active" })).toEqual(["u-1"]);
    expect(by({ status: "pending" })).toEqual(["u-2", "u-3"]);
    expect(by({ roleId: "r-1", status: "pending" })).toEqual(["u-2"]);
  });
});

describe("the filter's options", () => {
  it("lists the actives' years newest first, once each", () => {
    expect(graduationYearOptions([...ROWS, ROWS[0]!])).toEqual([2028, 2027]);
  });

  it("leaves the Alumni system role and unnamed rows out of the roles", () => {
    expect(
      parseFilterRoles([
        { id: "r-1", name: "Member", color: "#f2994a" },
        { id: "r-2", name: "Off palette", color: "#123456" },
        { id: "r-al", name: "Alumni", system_key: "ALUMNI" },
        { id: "r-x", name: "" },
        "junk",
      ]),
    ).toEqual([
      // Palette colors only, as every other role-color path paints them.
      { id: "r-1", name: "Member", color: "#F2994A" },
      { id: "r-2", name: "Off palette", color: null },
    ]);
  });

  it("matches a typed role by word starts, case and accents ignored, as web does", () => {
    const roles = [
      { id: "1", name: "Rush Chair", color: null },
      { id: "2", name: "Social Chair", color: null },
      { id: "3", name: "Trésorier", color: null },
      { id: "4", name: "Brush Captain", color: null },
      { id: "5", name: "VP/Recruitment", color: null },
      { id: "6", name: "(Exec) Treasurer", color: null },
    ];
    expect(searchFilterRoles(roles, "rush").map((r) => r.id)).toEqual(["1"]);
    expect(searchFilterRoles(roles, "CH").map((r) => r.id)).toEqual(["1", "2"]);
    expect(searchFilterRoles(roles, "treso").map((r) => r.id)).toEqual(["3"]);
    expect(searchFilterRoles(roles, "rec").map((r) => r.id)).toEqual(["5"]);
    expect(searchFilterRoles(roles, "exec").map((r) => r.id)).toEqual(["6"]);
    expect(searchFilterRoles(roles, "  ")).toHaveLength(6);
  });

  it("counts punctuation alone as no role query", () => {
    expect(hasRoleQuery("(")).toBe(false);
    expect(hasRoleQuery(" / ")).toBe(false);
    expect(hasRoleQuery("(e")).toBe(true);
  });
});

describe("effectiveActivesFilter", () => {
  const known = {
    roleIds: new Set(["r-1"]),
    years: [2027],
    classIds: new Set(["pc-a"]),
  };

  it("keeps picks that still exist", () => {
    const filter = {
      roleId: "r-1",
      graduationYear: 2027,
      pledgeClassId: "pc-a",
      status: "active" as const,
    };
    expect(effectiveActivesFilter(filter, known)).toEqual(filter);
    expect(countActivesFilters(filter)).toBe(4);
  });

  it("drops a deleted role, a vanished year and an unread class", () => {
    const filter = {
      roleId: "r-gone",
      graduationYear: 2030,
      pledgeClassId: "pc-gone",
      status: null,
    };
    expect(effectiveActivesFilter(filter, known)).toEqual(NO_ACTIVES_FILTER);
    expect(countActivesFilters(NO_ACTIVES_FILTER)).toBe(0);
  });
});
