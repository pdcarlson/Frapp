import { describe, expect, it } from "vitest";

import {
  ROLE_COLOR_HEXES,
  ROLE_COLOR_PALETTE,
  resolveCustomRoleNames,
  resolveRoleChips,
  roleColor,
  roleColorOrNull,
  topRoleColor,
} from "./role-colors";

// The palette's contrast against the Signet surfaces is guarded in
// apps/web/components/roles/role-colors-contrast.spec.ts, which reads the
// surfaces from the token source.

describe("ROLE_COLOR_PALETTE", () => {
  it("has unique keys and uppercase #RRGGBB values", () => {
    const keys = ROLE_COLOR_PALETTE.map((swatch) => swatch.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(ROLE_COLOR_HEXES).size).toBe(ROLE_COLOR_HEXES.length);
    for (const hex of ROLE_COLOR_HEXES) {
      expect(hex).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});

describe("roleColorOrNull", () => {
  it("returns the palette hex for a palette value in any case", () => {
    expect(roleColorOrNull("#f2994a")).toBe("#F2994A");
    expect(roleColorOrNull(" #F2994A ")).toBe("#F2994A");
  });

  it("returns null for the pre-#3485 seeds, other hexes and non-strings", () => {
    expect(roleColorOrNull("#FFD700")).toBeNull();
    expect(roleColorOrNull("#10B981")).toBeNull();
    expect(roleColorOrNull("#6B7280")).toBeNull();
    expect(roleColorOrNull("#123456")).toBeNull();
    expect(roleColorOrNull(null)).toBeNull();
    expect(roleColorOrNull(undefined)).toBeNull();
    expect(roleColorOrNull(42)).toBeNull();
  });
});

describe("topRoleColor", () => {
  const roles = [
    { id: "president", color: roleColor("orange"), display_order: 1 },
    { id: "treasurer", color: roleColor("green"), display_order: 2 },
    { id: "member", color: null, display_order: 5 },
    { id: "legacy", color: "#FFD700", display_order: 0 },
  ];

  it("picks the lowest display_order role that has a palette color", () => {
    expect(topRoleColor(roles, ["member", "treasurer", "president"])).toBe(
      "#F2994A",
    );
    expect(topRoleColor(roles, ["member", "treasurer"])).toBe("#6FD08C");
  });

  it("skips uncolored and off-palette roles instead of letting them win", () => {
    expect(topRoleColor(roles, ["legacy", "treasurer"])).toBe("#6FD08C");
    expect(topRoleColor(roles, ["member"])).toBeNull();
  });

  it("returns null for no roles or unknown ids", () => {
    expect(topRoleColor(roles, [])).toBeNull();
    expect(topRoleColor(roles, ["gone"])).toBeNull();
  });

  it("breaks display_order ties by role id, not row order", () => {
    const tied = [
      { id: "b", color: roleColor("sky"), display_order: 3 },
      { id: "a", color: roleColor("rose"), display_order: 3 },
    ];
    expect(topRoleColor(tied, ["a", "b"])).toBe("#F47FA4");
    expect(topRoleColor([...tied].reverse(), ["a", "b"])).toBe("#F47FA4");
  });
});

describe("resolveRoleChips", () => {
  const roles = [
    { id: "r-1", name: "President", color: "#F2994A", display_order: 1 },
    { id: "r-2", name: "Treasurer", color: null, display_order: 3 },
    { id: "r-3", name: "Brothers", color: "#123456", display_order: 9 },
  ];

  it("orders chips by the chapter's role rank, not by the member's list", () => {
    expect(resolveRoleChips(roles, ["r-2", "r-1"]).map((c) => c.name)).toEqual([
      "President",
      "Treasurer",
    ]);
  });

  it("keeps a palette color and drops one the palette doesn't hold", () => {
    expect(resolveRoleChips(roles, ["r-1", "r-3"])).toEqual([
      { id: "r-1", name: "President", color: "#F2994A" },
      { id: "r-3", name: "Brothers", color: null },
    ]);
  });

  it("drops an id with no match rather than rendering a raw id", () => {
    expect(
      resolveRoleChips(roles, ["r-1", "r-deleted"]).map((c) => c.id),
    ).toEqual(["r-1"]);
  });

  it("returns nothing while the roles list hasn't loaded", () => {
    expect(resolveRoleChips(undefined, ["r-1"])).toEqual([]);
  });

  it("draws a duplicated role id once", () => {
    expect(resolveRoleChips(roles, ["r-1", "r-1"])).toHaveLength(1);
  });
});

describe("resolveCustomRoleNames", () => {
  const customRoles = [
    { id: "cr-1", label: "Rush Chair" },
    { id: "cr-2", label: "Social Chair" },
  ];

  it("resolves ids to labels", () => {
    expect(resolveCustomRoleNames(customRoles, ["cr-1"])).toEqual([
      "Rush Chair",
    ]);
  });

  it("returns nothing when the viewer cannot resolve them (data undefined)", () => {
    expect(resolveCustomRoleNames(undefined, ["cr-1"])).toEqual([]);
  });

  it("returns nothing for an empty id list", () => {
    expect(resolveCustomRoleNames(customRoles, [])).toEqual([]);
  });

  it("drops a duplicate and an unmatched id", () => {
    expect(
      resolveCustomRoleNames(customRoles, ["cr-1", "cr-1", "cr-deleted"]),
    ).toEqual(["Rush Chair"]);
  });
});
