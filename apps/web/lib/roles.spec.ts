import { describe, it, expect } from "vitest";
import { normalizeRoleOptions, roleAccessRows } from "./roles";

describe("normalizeRoleOptions", () => {
  it("keeps well-formed roles and drops malformed entries", () => {
    expect(
      normalizeRoleOptions([
        { id: "r1", name: "Exec" },
        { id: 2, name: "Bad id" },
        { id: "r3" },
        null,
        "nope",
        { id: "r4", name: "Committee", extra: true },
      ]),
    ).toEqual([
      { id: "r1", name: "Exec" },
      { id: "r4", name: "Committee" },
    ]);
  });

  it("drops, keeps or hides the Everyone role as the caller asks (#4191)", () => {
    const rows = [
      { id: "r1", name: "Exec" },
      { id: "r2", name: "Everyone", system_key: "MEMBER" },
    ];
    expect(normalizeRoleOptions(rows).map((r) => r.id)).toEqual(["r1"]);
    expect(normalizeRoleOptions(rows, "keep")).toEqual([
      { id: "r1", name: "Exec" },
      { id: "r2", name: "Everyone" },
    ]);
    expect(normalizeRoleOptions(rows, "hide")[1]).toEqual({
      id: "r2",
      name: "Everyone",
      hidden: true,
    });
  });

  it("returns an empty array for non-array input", () => {
    expect(normalizeRoleOptions(undefined)).toEqual([]);
    expect(normalizeRoleOptions(null)).toEqual([]);
    expect(normalizeRoleOptions({})).toEqual([]);
  });
});

describe("roleAccessRows", () => {
  it("keeps the checklist's rows with their string permissions, defaulting a missing list to none", () => {
    expect(
      roleAccessRows([
        { id: "r1", name: "Member", permissions: ["members:view", 3] },
        { id: "r2", name: "Bare" },
        { name: "No id", permissions: ["*"] },
        { id: "r3", permissions: ["members:view"] },
        null,
      ]),
    ).toEqual([
      { id: "r1", permissions: ["members:view"], system_key: null },
      { id: "r2", permissions: [], system_key: null },
    ]);
    expect(roleAccessRows(undefined)).toEqual([]);
  });
});
