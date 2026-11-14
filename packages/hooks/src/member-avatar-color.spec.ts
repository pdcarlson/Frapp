import { contrastRatio, parseHex } from "@repo/color";
import { ROLE_COLOR_PALETTE } from "@repo/validation";
import { describe, expect, it } from "vitest";

import {
  MEMBER_HASH_HUES,
  fnv1a32,
  memberAvatarHue,
  memberAvatarTint,
  memberHashHue,
} from "./member-avatar-color";

const AA_TEXT = 4.5;

function ratio(a: string, b: string): number {
  return contrastRatio(parseHex(a)!, parseHex(b)!);
}

describe("fnv1a32", () => {
  it("matches the published 32-bit FNV-1a test vectors", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
  });
});

describe("MEMBER_HASH_HUES", () => {
  it("is the #3860 order: the role palette minus Sand and Slate", () => {
    // Reordering this list recolors every member: a deliberate change only.
    expect(MEMBER_HASH_HUES).toEqual([
      "#F2994A", // Orange
      "#F47FA4", // Rose
      "#B392F0", // Violet
      "#8FA8FF", // Periwinkle
      "#5CC8F0", // Sky
      "#3DD6C4", // Teal
      "#6FD08C", // Green
      "#C5E06A", // Lime
    ]);
  });
});

describe("memberHashHue", () => {
  it("is stable for a given id, whatever its case", () => {
    // Pinned outputs: if these move, every member's avatar changed color.
    const pinned: Record<string, string> = {
      "00000000-0000-0000-0000-000000000001": "#6FD08C", // Green
      "3f2504e0-4f89-11d3-9a0c-0305e82c3301": "#F2994A", // Orange
      "c56a4180-65aa-42ec-a945-5fd21dec0538": "#8FA8FF", // Periwinkle
    };
    for (const [id, hue] of Object.entries(pinned)) {
      expect(memberHashHue(id)).toBe(hue);
      expect(memberHashHue(id.toUpperCase())).toBe(hue);
    }
  });

  it("splits ids evenly across the eight hues", () => {
    // A deterministic stream of v4-shaped ids (LCG), so the run is repeatable.
    let seed = 0x2f6b1d3c;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed.toString(16).padStart(8, "0");
    };
    const counts = new Map<string, number>();
    const total = 80_000;
    for (let i = 0; i < total; i += 1) {
      const a = next();
      const b = next();
      const c = next();
      const d = next();
      const id = `${a}-${b.slice(0, 4)}-4${b.slice(5, 8)}-a${c.slice(1, 4)}-${c.slice(4)}${d}`;
      const hue = memberHashHue(id);
      counts.set(hue, (counts.get(hue) ?? 0) + 1);
    }
    expect(counts.size).toBe(MEMBER_HASH_HUES.length);
    const even = total / MEMBER_HASH_HUES.length;
    for (const count of counts.values()) {
      expect(Math.abs(count - even) / even).toBeLessThan(0.05);
    }
  });
});

describe("memberAvatarHue", () => {
  it("takes the member's role color when their role colors their name", () => {
    expect(memberAvatarHue("any-id", "#6FD08C")).toBe("#6FD08C");
    expect(memberAvatarHue("any-id", "#d9b99b")).toBe("#D9B99B");
  });

  it("falls back to the hashed hue without a palette role color", () => {
    const id = "c56a4180-65aa-42ec-a945-5fd21dec0538";
    expect(memberAvatarHue(id, null)).toBe(memberHashHue(id));
    expect(memberAvatarHue(id, undefined)).toBe(memberHashHue(id));
    // An off-palette legacy value paints nothing it wasn't checked for.
    expect(memberAvatarHue(id, "#FFD700")).toBe(memberHashHue(id));
  });
});

describe("memberAvatarTint contrast", () => {
  // Every role color can reach an avatar (officers), so all ten are checked,
  // Sand (6.01) and Slate (5.44) included, not only the eight hashed hues.
  it.each(ROLE_COLOR_PALETTE.map((s) => [s.label, s.hex] as const))(
    "%s initials read at AA on their 14%% tint",
    (_label, hex) => {
      const tint = memberAvatarTint(hex);
      expect(tint.text).toBe(hex);
      expect(ratio(tint.text, tint.fill)).toBeGreaterThanOrEqual(AA_TEXT);
    },
  );

  it("reproduces the #3860 measurements, re-seated for the #3826 ladder", () => {
    // #3860 measured 18% over the old `--popover`: Orange `#443426` at 5.34:1,
    // Violet 4.79:1. 14% over the new `--card` paints nearly the same fill.
    expect(memberAvatarTint("#F2994A").fill).toBe("#43362B");
    expect(ratio("#F2994A", memberAvatarTint("#F2994A").fill)).toBeCloseTo(
      5.24,
      1,
    );
    expect(ratio("#B392F0", memberAvatarTint("#B392F0").fill)).toBeCloseTo(
      4.69,
      1,
    );
  });
});
