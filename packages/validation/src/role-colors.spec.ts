import { describe, expect, it } from "vitest";

import {
  ROLE_COLOR_HEXES,
  ROLE_COLOR_PALETTE,
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
    {
      id: "president",
      name: "president",
      color: roleColor("orange"),
      display_order: 1,
    },
    {
      id: "treasurer",
      name: "treasurer",
      color: roleColor("green"),
      display_order: 2,
    },
    { id: "member", name: "member", color: null, display_order: 5 },
    { id: "legacy", name: "legacy", color: "#FFD700", display_order: 0 },
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

  it("ranks by tier before display_order, so an untiered role at 0 never wins", () => {
    const tiered = [
      {
        id: "pres",
        name: "President",
        color: roleColor("orange"),
        display_order: 1,
        tier_id: "cabinet",
      },
      {
        id: "floor",
        name: "First Floor",
        color: roleColor("sky"),
        display_order: 0,
        tier_id: null,
      },
    ];
    const positions = new Map([["cabinet", 1]]);
    expect(topRoleColor(tiered, ["floor", "pres"], positions)).toBe("#F2994A");
  });

  it("breaks display_order ties by role id, not row order", () => {
    const tied = [
      { id: "b", name: "Same", color: roleColor("sky"), display_order: 3 },
      { id: "a", name: "Same", color: roleColor("rose"), display_order: 3 },
    ];
    expect(topRoleColor(tied, ["a", "b"])).toBe("#F47FA4");
    expect(topRoleColor([...tied].reverse(), ["a", "b"])).toBe("#F47FA4");
  });
});
