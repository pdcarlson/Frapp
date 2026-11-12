import { describe, expect, it } from "vitest";

import {
  isEveryoneRole,
  isEveryoneRoleName,
  rolesAfterSave,
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
    // Nor does a shipped build's tap on its chip take it away.
    expect(rolesAfterSave([], ["everyone"], roles)).toEqual(["everyone"]);
  });

  it("gives Everyone to a pledge made a member, a chair or both", () => {
    expect(rolesAfterSave([], ["new"], roles)).toEqual(["everyone"]);
    expect(rolesAfterSave(["chair"], ["new"], roles)).toEqual([
      "chair",
      "everyone",
    ]);
    // A pledge class role grants nothing, so it doesn't stand in for Everyone.
    expect(rolesAfterSave(["pc-2026"], ["new", "pc-2026"], roles)).toEqual([
      "pc-2026",
      "everyone",
    ]);
  });

  it("gives Everyone when the save leaves no role granting member access", () => {
    expect(rolesAfterSave(["pc-2026"], ["chair", "pc-2026"], roles)).toEqual([
      "pc-2026",
      "everyone",
    ]);
  });

  it("doesn't hand Everyone to an officer who never held it", () => {
    expect(rolesAfterSave(["chair", "pc-2026"], ["chair"], roles)).toEqual([
      "chair",
      "pc-2026",
    ]);
  });

  it("never leaves Everyone beside New Member or Alumni", () => {
    expect(rolesAfterSave(["everyone", "alumni"], ["everyone"], roles)).toEqual(
      ["alumni"],
    );
    expect(rolesAfterSave(["new"], ["everyone"], roles)).toEqual(["new"]);
    // An alumnus who held both before keeps neither copy of it on a save.
    expect(
      rolesAfterSave(
        ["alumni", "everyone", "chair"],
        ["alumni", "everyone"],
        roles,
      ),
    ).toEqual(["alumni", "chair"]);
    // A shipped build ticking the Everyone chip on an alumnus moves nothing.
    expect(rolesAfterSave(["alumni", "everyone"], ["alumni"], roles)).toEqual([
      "alumni",
    ]);
  });

  it("demotes even where New Member and Alumni carry no member access", () => {
    const tightened = roles.map((role) =>
      role.id === "new" || role.id === "alumni"
        ? { ...role, permissions: [] }
        : role,
    );
    expect(rolesAfterSave(["new"], ["everyone"], tightened)).toEqual(["new"]);
    expect(rolesAfterSave(["new", "pc-2026"], ["new"], tightened)).toEqual([
      "new",
      "pc-2026",
    ]);
  });

  it("changes nothing for a chapter with no Everyone role", () => {
    const legacy = roles.filter((role) => role.id !== "everyone");
    expect(rolesAfterSave([], ["new"], legacy)).toEqual([]);
    expect(rolesAfterSave(["chair", "x"], [], legacy)).toEqual(["chair", "x"]);
  });
});
