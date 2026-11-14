import { applyAlpha } from "@repo/color";
import { signetDarkTokens } from "@repo/theme/signet";
import {
  ROLE_COLOR_PALETTE,
  roleColorOrNull,
  type RoleColorHex,
} from "@repo/validation";

/**
 * The color an initials avatar wears when a member has no photo (#3860, Paul
 * approved 2026-11-10; `spec/ui/design-system/components.md` §7 and §11).
 *
 * Officers whose role colors their name get that same role color, so avatar
 * and name always match and both change when the role does. Everyone else gets
 * a stable hue from {@link MEMBER_HASH_HUES}, keyed on their user id, so the
 * same member wears the same color on every surface, device and app.
 */

/**
 * The hashed hues, in this order: `ROLE_COLOR_PALETTE` minus Sand and Slate,
 * which read close to gray beside the neutral fallback. The order is part of
 * the hash contract: reordering it recolors every member, so the spec pins it.
 */
export const MEMBER_HASH_HUES: readonly RoleColorHex[] =
  ROLE_COLOR_PALETTE.filter(
    (swatch) => swatch.key !== "sand" && swatch.key !== "slate",
  ).map((swatch) => swatch.hex);

/**
 * The tint's opacity over `--card`. Until the 2026-11-12 surface ladder (#3826)
 * it was 18% over `--popover` (`#1E1E1E`), where 22% put Violet and Rose under
 * AA. The new `--popover` (`#313131`) is too light for that recipe: 18% over it
 * leaves Violet's initials at 3.80:1. 14% over `--card` (`#262626`) paints
 * nearly the fill the old recipe did (Orange `#43362B`, was `#443426`) and
 * keeps every hue's initials at 4.69:1 or better.
 */
const MEMBER_AVATAR_TINT_ALPHA = 0.14;

/**
 * 32-bit FNV-1a over the string's UTF-16 code units, as an unsigned integer.
 * User ids are ASCII UUIDs, so this equals FNV-1a over their UTF-8 bytes.
 */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The stable hashed hue for a member: FNV-1a of the lowercased id, mod 8. */
export function memberHashHue(userId: string): RoleColorHex {
  const hues = MEMBER_HASH_HUES;
  return hues[fnv1a32(userId.toLowerCase()) % hues.length]!;
}

/**
 * The hue a member's initials avatar wears: the role color that paints their
 * name when there is one (pass `roleColorFor(userId)`, the same resolution the
 * name uses), otherwise their stable hashed hue.
 */
export function memberAvatarHue(
  userId: string,
  roleColor: string | null | undefined,
): RoleColorHex {
  return roleColorOrNull(roleColor) ?? memberHashHue(userId);
}

/** An initials avatar's paint: the circle's fill and the initials' color. */
export interface MemberAvatarTint {
  /** The hue at 14% over `--card`, flattened to an opaque hex. */
  fill: string;
  /** The full hue. */
  text: string;
}

/** Style A ("tinted"): the hue at 14% over `--card`, initials in the hue. */
export function memberAvatarTint(hue: string): MemberAvatarTint {
  return {
    fill: applyAlpha(
      hue,
      MEMBER_AVATAR_TINT_ALPHA,
      signetDarkTokens.color.surface.card,
    ),
    text: hue,
  };
}
