import { describe, expect, it } from "vitest";

import {
  isEveryoneRole,
  isEveryoneRoleName,
  rolesAfterSave,
  withoutEveryoneRole,
  type EveryoneSaveRole,
} from "./everyone-role";

const roles: EveryoneSaveRole[] = [
  { id: "president", system_key: "PRESIDENT", permissions: ["*"] },
  { id: "everyone", system_key: "MEMBER", permissions: ["members:view"] },
  { id: "new", system_key: "NEW_MEMBER", permissions: ["members:view"] },
  { id: "alumni", system_key: "ALUMNI", permissions: ["members:view"] },
  {
    id: "chair",
    system_key: null,
    permissions: ["members:view", "tasks:manage"],
  },
  { id: "pc-2026", system_key: null, permissions: [] },
];

describe("isEveryoneRole (#4191)", () => {
  it("reads the role by its key, never its name", () => {
    expect(isEveryoneRole({ system_key: "MEMBER", name: "Actives" })).toBe(
      true,
    );
    expect(isEveryoneRole({ system_key: null, name: "Everyone" })).toBe(false);
    expect(isEveryoneRole(null)).toBe(false);
    expect(isEveryoneRole("MEMBER")).toBe(false);
  });

  it("drops it from a list, keeping the order", () => {
    expect(withoutEveryoneRole(roles).map((role) => role.id)).toEqual([
      "president",
      "new",
      "alumni",
      "chair",
      "pc-2026",
    ]);
  });
});

describe("isEveryoneRoleName (#4191)", () => {
  it("catches every name that reads as @everyone", () => {
    expect(isEveryoneRoleName("Everyone")).toBe(true);
    expect(isEveryoneRoleName(" every-one ")).toBe(true);
    expect(isEveryoneRoleName("EVERY ONE")).toBe(true);
  });

  it("leaves a name that only contains the word", () => {
    expect(isEveryoneRoleName("Everyone (role)")).toBe(false);
    expect(isEveryoneRoleName("Everyone else")).toBe(false);
    expect(isEveryoneRoleName("Member")).toBe(false);
  });
});

describe("rolesAfterSave (#4191)", () => {
  it("keeps Everyone for a member made a chair", () => {
    expect(rolesAfterSave(["everyone", "chair"], ["everyone"], roles)).toEqual([
      "everyone",
      "chair",
    ]);
    // A save that leaves Everyone off still keeps it: nobody unticks it.
    expect(rolesAfterSave(["chair"], ["everyone"], roles)).toEqual([
      "chair",
      "everyone",
    ]);
  });

  it("gives Everyone when the save leaves no role granting member access", () => {
    // Taking New Member away from a pledge makes them a plain member.
    expect(rolesAfterSave([], ["new"], roles)).toEqual(["everyone"]);
    // A pledge class role grants nothing, so it doesn't count.
    expect(rolesAfterSave(["pc-2026"], ["new", "pc-2026"], roles)).toEqual([
      "pc-2026",
      "everyone",
    ]);
  });

  it("takes Everyone away from a member made Alumni or New Member", () => {
    expect(rolesAfterSave(["everyone", "alumni"], ["everyone"], roles)).toEqual(
      ["alumni"],
    );
    expect(rolesAfterSave(["new"], ["everyone"], roles)).toEqual(["new"]);
  });

  it("doesn't give Everyone to a member who holds a lower role already", () => {
    // An alumnus whose chair is added keeps no Everyone they didn't hold.
    expect(rolesAfterSave(["alumni", "chair"], ["alumni"], roles)).toEqual([
      "alumni",
      "chair",
    ]);
    // A shipped build ticking the Everyone chip on an alumnus moves nothing.
    expect(rolesAfterSave(["alumni", "everyone"], ["alumni"], roles)).toEqual([
      "alumni",
    ]);
  });

  it("ignores a shipped build unticking the Everyone chip", () => {
    expect(rolesAfterSave([], ["everyone"], roles)).toEqual(["everyone"]);
  });

  it("changes nothing for a chapter with no Everyone role", () => {
    const legacy = roles.filter((role) => role.id !== "everyone");
    expect(rolesAfterSave([], ["new"], legacy)).toEqual([]);
    expect(rolesAfterSave(["chair", "x"], [], legacy)).toEqual(["chair", "x"]);
  });
});
