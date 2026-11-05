import { describe, expect, it } from "vitest";

import {
  ROLE_COLOR_HEXES,
  ROLE_COLOR_PALETTE,
  roleColor,
  roleColorOrNull,
  topRoleColor,
} from "./role-colors";

// WCAG 2.x relative luminance, restated here so this guard needs no runtime
// dependency on `@repo/color` (which owns the product's copy).
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Signet dark surfaces (`packages/theme/src/signet.ts`), darkest to lightest.
const SURFACES = ["#131211", "#1A1A1A", "#211E1A", "#2A2621"];

describe("ROLE_COLOR_PALETTE", () => {
  it("has unique keys and uppercase #RRGGBB values", () => {
    const keys = ROLE_COLOR_PALETTE.map((swatch) => swatch.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(ROLE_COLOR_HEXES).size).toBe(ROLE_COLOR_HEXES.length);
    for (const hex of ROLE_COLOR_HEXES) {
      expect(hex).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it.each(ROLE_COLOR_PALETTE.map((swatch) => [swatch.label, swatch.hex]))(
    "%s stays AA-readable as text on every charcoal surface",
    (_label, hex) => {
      for (const surface of SURFACES) {
        expect(contrast(hex, surface)).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
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
