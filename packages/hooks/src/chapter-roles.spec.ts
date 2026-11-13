import { describe, expect, it } from "vitest";
import {
  isLockedRole,
  parseChapterRoles,
  toRoleOptions,
} from "./chapter-roles";

const PRESIDENT = {
  id: "r-pres",
  name: "President",
  is_system: true,
  system_key: "PRESIDENT",
  permissions: ["*"],
  color: "#E74C3C",
};
const LEGACY_WILDCARD = {
  id: "r-legacy",
  name: "Old Admin",
  is_system: false,
  system_key: null,
  permissions: ["*", "events:create"],
};
const EVERYONE = {
  id: "r-everyone",
  name: "Everyone",
  is_system: true,
  system_key: "MEMBER",
  permissions: ["members:view"],
};
const DISCORD = {
  id: "r-discord",
  name: "Rush",
  is_system: false,
  permissions: ["channel:read:abc"],
  color: "not-a-color",
};

describe("parseChapterRoles", () => {
  it("locks the system President role", () => {
    const [president] = parseChapterRoles([PRESIDENT]);
    expect(president).toMatchObject({
      id: "r-pres",
      locked: true,
      is_system: true,
      system_key: "PRESIDENT",
      grantsBase: true,
      everyone: false,
    });
  });

  it("locks a custom role holding * too, as the API refuses to move it", () => {
    const [legacy] = parseChapterRoles([LEGACY_WILDCARD]);
    expect(legacy?.locked).toBe(true);
    expect(legacy?.is_system).toBe(false);
  });

  it("leaves a role without * unlocked, and reads access and Everyone", () => {
    const [everyone, discord] = parseChapterRoles([EVERYONE, DISCORD]);
    expect(everyone).toMatchObject({
      locked: false,
      everyone: true,
      grantsBase: true,
    });
    expect(discord).toMatchObject({
      locked: false,
      everyone: false,
      grantsBase: false,
      // Palette colors only.
      color: null,
      system_key: null,
    });
  });

  it("drops malformed rows and non-string permissions", () => {
    expect(
      parseChapterRoles([
        null,
        "role",
        { id: "no-name" },
        { name: "no-id" },
        { id: 7, name: "numeric id" },
        { id: "blank", name: "  " },
        { id: "ok", name: "Ok", permissions: ["events:create", 3, null] },
      ]),
    ).toEqual([
      expect.objectContaining({
        id: "ok",
        permissions: ["events:create"],
        locked: false,
        is_system: false,
      }),
    ]);
  });

  it("paints palette colors only, in any case", () => {
    const [warm, off] = parseChapterRoles([
      { id: "a", name: "A", color: "#f2994a" },
      { id: "b", name: "B", color: "#ff0000" },
    ]);
    expect(warm?.color).toBe("#F2994A");
    expect(off?.color).toBeNull();
  });

  it("reads a payload that isn't a list as no roles", () => {
    expect(parseChapterRoles(undefined)).toEqual([]);
    expect(parseChapterRoles(null)).toEqual([]);
    expect(parseChapterRoles({ error: "nope" })).toEqual([]);
  });
});

describe("isLockedRole", () => {
  it("is the wildcard, whatever else the role holds", () => {
    expect(isLockedRole(["*"])).toBe(true);
    expect(isLockedRole(["members:view", "*"])).toBe(true);
    expect(isLockedRole(["roles:manage"])).toBe(false);
    expect(isLockedRole([])).toBe(false);
  });
});

describe("toRoleOptions", () => {
  const rows = [PRESIDENT, EVERYONE, { id: 1, name: "bad" }];

  it("drops the Everyone role by default", () => {
    expect(toRoleOptions(rows)).toEqual([{ id: "r-pres", name: "President" }]);
  });

  it("keeps it, or keeps it hidden, when asked", () => {
    expect(toRoleOptions(rows, "keep")).toEqual([
      { id: "r-pres", name: "President" },
      { id: "r-everyone", name: "Everyone" },
    ]);
    expect(toRoleOptions(rows, "hide")[1]).toEqual({
      id: "r-everyone",
      name: "Everyone",
      hidden: true,
    });
  });
});
