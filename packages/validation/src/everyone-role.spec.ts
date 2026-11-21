import { describe, expect, it } from "vitest";

import {
  baseRoleIds,
  isBaseRole,
  isEveryoneRole,
  mentionRoleHint,
  reservedMentionName,
  rolesAfterSave,
  withHereMention,
  type EveryoneSaveRole,
} from "./everyone-role";

const roles: EveryoneSaveRole[] = [
  { id: "president", system_key: "PRESIDENT", permissions: ["*"] },
  { id: "everyone", system_key: "EVERYONE", permissions: ["members:view"] },
  { id: "actives", system_key: "MEMBER", permissions: ["members:view"] },
  { id: "new", system_key: "NEW_MEMBER", permissions: ["members:view"] },
  { id: "alumni", system_key: "ALUMNI", permissions: ["members:view"] },
  {
    id: "chair",
    system_key: null,
    permissions: ["members:view", "tasks:manage"],
  },
  { id: "pc-2026", system_key: null, permissions: [] },
];

describe("isEveryoneRole", () => {
  it("reads the role by its key, never its name", () => {
    expect(isEveryoneRole({ system_key: "EVERYONE", name: "All" })).toBe(true);
    // The Actives role was the Everyone role until 2026-11-21.
    expect(isEveryoneRole({ system_key: "MEMBER", name: "Everyone" })).toBe(
      false,
    );
    expect(isEveryoneRole({ system_key: null, name: "Everyone" })).toBe(false);
    expect(isEveryoneRole(null)).toBe(false);
    expect(isEveryoneRole("MEMBER")).toBe(false);
  });
});

describe("reservedMentionName", () => {
  it("leaves a name that only contains the word", () => {
    expect(reservedMentionName("Everyone (role)")).toBeNull();
    expect(reservedMentionName("Everyone else")).toBeNull();
    expect(reservedMentionName("Member")).toBeNull();
  });

  it("names the chapter-wide mention a role name would read as", () => {
    expect(reservedMentionName("Every One")).toBe("everyone");
    expect(reservedMentionName(" HERE ")).toBe("here");
    expect(reservedMentionName("he-re")).toBe("here");
    expect(reservedMentionName("Here and now")).toBeNull();
    expect(reservedMentionName("Officers")).toBeNull();
  });
});

describe("withHereMention", () => {
  const list = [
    { role_id: "r1", name: "Officers", mentionable: true, color: "blue" },
    { role_id: "r2", name: "everyone", mentionable: false, color: null },
    { role_id: "r3", name: "Brothers", mentionable: true, color: null },
  ];

  it("puts @here right after @everyone, on its switch", () => {
    const out = withHereMention(list);
    expect(out.map((role) => role.name)).toEqual([
      "Officers",
      "everyone",
      "here",
      "Brothers",
    ]);
    expect(out[2]).toEqual({
      role_id: "r2:here",
      name: "here",
      mentionable: false,
      color: null,
    });
  });

  it("adds nothing without @everyone", () => {
    expect(withHereMention([list[0]!])).toEqual([list[0]]);
  });
});

describe("mentionRoleHint", () => {
  it("says who @everyone and @here reach, and Role otherwise", () => {
    expect(mentionRoleHint("everyone")).toBe("Notifies the whole channel");
    expect(mentionRoleHint("here")).toBe("Notifies who's online");
    expect(mentionRoleHint("Officers")).toBe("Role");
  });

  it("names a tier and a group by kind, and reads no kind as a role", () => {
    expect(mentionRoleHint("Exec board", "tier")).toBe("Tier");
    expect(mentionRoleHint("Third floor", "group")).toBe("Group");
    expect(mentionRoleHint("Officers", "role")).toBe("Role");
    expect(mentionRoleHint("Officers", undefined)).toBe("Role");
    expect(mentionRoleHint("everyone", "tier")).toBe(
      "Notifies the whole channel",
    );
  });
});

describe("isBaseRole", () => {
  it("is New Member, Actives and Alumni, by key", () => {
    expect(roles.filter(isBaseRole).map((role) => role.id)).toEqual([
      "actives",
      "new",
      "alumni",
    ]);
  });
});

describe("rolesAfterSave", () => {
  it("always keeps Everyone, last, whatever the save sent", () => {
    expect(rolesAfterSave(["chair"], ["everyone"], roles)).toEqual([
      "chair",
      "everyone",
    ]);
    expect(rolesAfterSave([], [], roles)).toEqual(["everyone"]);
    expect(
      rolesAfterSave(["everyone", "actives"], ["everyone"], roles),
    ).toEqual(["actives", "everyone"]);
  });

  it("gives nothing else: no base role leaves only Everyone", () => {
    expect(rolesAfterSave([], ["actives", "everyone"], roles)).toEqual([
      "everyone",
    ]);
    expect(rolesAfterSave(["pc-2026"], ["new"], roles)).toEqual([
      "pc-2026",
      "everyone",
    ]);
  });

  it("swaps the base role: the one the save adds wins", () => {
    // A pledge made an active.
    expect(
      rolesAfterSave(["new", "actives"], ["new", "everyone"], roles),
    ).toEqual(["actives", "everyone"]);
    // An active made a grad, keeping their other roles.
    expect(
      rolesAfterSave(
        ["actives", "chair", "alumni"],
        ["actives", "chair", "everyone"],
        roles,
      ),
    ).toEqual(["chair", "alumni", "everyone"]);
  });

  it("keeps an officer's roles on top of a base role", () => {
    expect(
      rolesAfterSave(["actives", "chair"], ["actives", "everyone"], roles),
    ).toEqual(["actives", "chair", "everyone"]);
  });

  it("leaves several held base roles as sent, for the API to refuse", () => {
    expect(
      rolesAfterSave(["new", "actives"], ["new", "actives"], roles),
    ).toEqual(["new", "actives", "everyone"]);
  });

  it("changes nothing but duplicates for a chapter with no Everyone role", () => {
    const legacy = roles.filter((role) => role.id !== "everyone");
    expect(rolesAfterSave(["chair", "x", "x"], [], legacy)).toEqual([
      "chair",
      "x",
    ]);
  });
});

describe("baseRoleIds", () => {
  it("lists the base roles a member holds", () => {
    expect(baseRoleIds(["chair", "alumni", "everyone"], roles)).toEqual([
      "alumni",
    ]);
  });
});
