import { AA_NORMAL, contrastRatio, hexToOklch, parseHex } from "@repo/color";
import { describe, expect, it } from "vitest";

import {
  adjustRoleColor,
  isPaintableRoleColor,
  isPaletteRoleColor,
  reservedBandForHue,
  reservedRoleHue,
  ROLE_COLOR_HEXES,
  ROLE_COLOR_PALETTE,
  ROLE_COLOR_RESERVED_BANDS,
  ROLE_COLOR_SURFACES,
  roleColor,
  roleColorForHue,
  roleColorHue,
  roleColorOrNull,
  topRoleColor,
} from "./role-colors";

function minContrast(hex: string): number {
  return Math.min(
    ...Object.values(ROLE_COLOR_SURFACES).map((surface) =>
      contrastRatio(parseHex(hex)!, parseHex(surface)!),
    ),
  );
}

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

  it("returns null for gold, red, too-dark hexes and non-strings", () => {
    // Pre-#3485 seeds: gold is reserved, the grey is too dark to read.
    expect(roleColorOrNull("#FFD700")).toBeNull();
    expect(roleColorOrNull("#6B7280")).toBeNull();
    expect(roleColorOrNull("#FF665C")).toBeNull();
    expect(roleColorOrNull("#EFB63B")).toBeNull();
    // A red that reads (5.5:1 on --card-hover): only the red band refuses it.
    expect(minContrast("#FF8A80")).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(roleColorOrNull("#FF8A80")).toBeNull();
    expect(roleColorOrNull("#123456")).toBeNull();
    expect(roleColorOrNull(null)).toBeNull();
    expect(roleColorOrNull(undefined)).toBeNull();
    expect(roleColorOrNull(42)).toBeNull();
    // A short #RGB is refused even when its long form reads (#77CCEE does).
    expect(roleColorOrNull("#77CCEE")).toBe("#77CCEE");
    expect(roleColorOrNull("#7ce")).toBeNull();
    expect(roleColorOrNull("blue")).toBeNull();
  });

  it("paints a custom hex that reads on every surface, uppercased", () => {
    // Emerald, the pre-#3485 seed: it reads at AA everywhere and isn't red
    // or gold, so since #5784 it paints.
    expect(roleColorOrNull("#10b981")).toBe("#10B981");
    expect(minContrast("#10B981")).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it("paints every palette value exactly as listed, including the two that need a hover lift", () => {
    for (const hex of ROLE_COLOR_HEXES) {
      expect(roleColorOrNull(hex)).toBe(hex);
      expect(roleColorOrNull(hex.toLowerCase())).toBe(hex);
      expect(isPaletteRoleColor(hex)).toBe(true);
    }
  });
});

describe("reserved hues", () => {
  it("reserves the danger reds and the brand golds, and none of the palette", () => {
    expect(reservedRoleHue("#FF665C")).toBe("red"); // --destructive
    expect(reservedRoleHue("#E5484D")).toBe("red"); // --mention
    expect(reservedRoleHue("#FF0000")).toBe("red");
    expect(reservedRoleHue("#EFB63B")).toBe("gold"); // house gold
    expect(reservedRoleHue("#FFD700")).toBe("gold");
    for (const hex of ROLE_COLOR_HEXES) expect(reservedRoleHue(hex)).toBeNull();
  });

  it("leaves greys and beiges alone whatever their hue", () => {
    expect(reservedRoleHue("#D9B99B")).toBeNull(); // Sand, 65°
    expect(reservedRoleHue("#C8BFB0")).toBeNull();
  });

  it("reads band edges as from-inclusive, to-exclusive", () => {
    for (const band of ROLE_COLOR_RESERVED_BANDS) {
      expect(reservedBandForHue(band.from)).toBe(band.key);
      expect(reservedBandForHue(band.to - 0.01)).toBe(band.key);
      expect(reservedBandForHue(band.to)).toBeNull();
      expect(reservedBandForHue(band.from - 0.01)).toBeNull();
    }
  });
});

describe("roleColorForHue", () => {
  const hues = Array.from({ length: 720 }, (_, index) => index / 2);

  it("paints every hue at AA on every surface, outside the reserved bands", () => {
    for (const hue of hues) {
      const { hex } = roleColorForHue(hue);
      expect(isPaintableRoleColor(hex), `${hue}° → ${hex}`).toBe(true);
      expect(roleColorOrNull(hex)).toBe(hex);
      expect(minContrast(hex)).toBeGreaterThanOrEqual(AA_NORMAL);
      expect(reservedRoleHue(hex), `${hue}° → ${hex}`).toBeNull();
    }
  });

  it("names the band it moved a hue out of, and only then", () => {
    for (const hue of hues) {
      expect(roleColorForHue(hue).nudged).toBe(reservedBandForHue(hue));
    }
  });

  it("keeps the hue it was given when that hue is allowed", () => {
    for (const hue of [0, 50, 140, 200, 265, 300, 330]) {
      const back = roleColorHue(roleColorForHue(hue).hex)!;
      const drift = Math.abs(((back - hue + 540) % 360) - 180);
      expect(drift, `${hue}° came back ${back}°`).toBeLessThan(3);
    }
  });

  it("stays saturated rather than washing out to near-white", () => {
    for (const hue of [0, 140, 200, 265, 300]) {
      expect(hexToOklch(roleColorForHue(hue).hex)!.c).toBeGreaterThan(0.1);
    }
  });
});

describe("adjustRoleColor", () => {
  it("returns a color that already reads as it is", () => {
    expect(adjustRoleColor("#10B981")).toEqual({
      hex: "#10B981",
      nudged: null,
    });
  });

  it("lifts a dark color until it reads, keeping its hue", () => {
    const result = adjustRoleColor("#1E3A8A")!; // a dark navy
    expect(result.nudged).toBeNull();
    expect(minContrast(result.hex)).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(
      Math.abs(roleColorHue(result.hex)! - roleColorHue("#1E3A8A")!),
    ).toBeLessThan(5);
  });

  it("moves red and gold out of their bands and says which", () => {
    expect(adjustRoleColor("#FF0000")!.nudged).toBe("red");
    expect(adjustRoleColor("#EFB63B")!.nudged).toBe("gold");
    for (const hex of ["#FF0000", "#EFB63B", "#FFD700", "#B91C1C"]) {
      const adjusted = adjustRoleColor(hex)!.hex;
      expect(isPaintableRoleColor(adjusted), `${hex} → ${adjusted}`).toBe(true);
    }
  });

  it("makes any color paintable", () => {
    // A deterministic sweep across the cube, every 17th step of each channel.
    for (let r = 0; r < 256; r += 51) {
      for (let g = 0; g < 256; g += 51) {
        for (let b = 0; b < 256; b += 51) {
          const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
          const adjusted = adjustRoleColor(hex)!.hex;
          expect(isPaintableRoleColor(adjusted), `${hex} → ${adjusted}`).toBe(
            true,
          );
        }
      }
    }
  });

  it("refuses a non-color", () => {
    expect(adjustRoleColor("blue")).toBeNull();
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
