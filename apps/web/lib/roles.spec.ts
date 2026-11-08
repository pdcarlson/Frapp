import { describe, it, expect } from "vitest";
import {
  memberAccessRoleIds,
  normalizeRoleOptions,
  removesMemberAccess,
} from "./roles";

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

  it("returns an empty array for non-array input", () => {
    expect(normalizeRoleOptions(undefined)).toEqual([]);
    expect(normalizeRoleOptions(null)).toEqual([]);
    expect(normalizeRoleOptions({})).toEqual([]);
  });
});

describe("member access", () => {
  const roles = [
    { id: "member", name: "Member", permissions: ["members:view"] },
    { id: "president", name: "President", permissions: ["*"] },
    { id: "cabinet", name: "Cabinet", permissions: ["channels:read:cabinet"] },
    { id: "bare", name: "Bare" },
  ];
  const custom = [
    { id: "rush", capabilities: ["members:view"] },
    { id: "wild", capabilities: ["*"] },
  ];

  it("collects live roles with members:view or *, and custom roles with members:view", () => {
    expect([...memberAccessRoleIds(roles, custom)].sort()).toEqual([
      "member",
      "president",
      "rush",
    ]);
    expect(memberAccessRoleIds(undefined).size).toBe(0);
  });

  it("flags only the save that takes access away", () => {
    const ids = memberAccessRoleIds(roles, custom);
    expect(removesMemberAccess(["member", "cabinet"], ["cabinet"], ids)).toBe(
      true,
    );
    expect(removesMemberAccess(["member"], ["cabinet", "rush"], ids)).toBe(
      false,
    );
    expect(removesMemberAccess(["cabinet"], [], ids)).toBe(false);
    expect(removesMemberAccess(["member"], ["member", "cabinet"], ids)).toBe(
      false,
    );
  });
});
