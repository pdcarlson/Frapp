import type { SignetTokens } from "@repo/theme/signet";
import type { ChapterBranding } from "@/lib/chapter-branding";
import { typeRole } from "@/lib/theme";

type TypeRole = SignetTokens["typography"]["role"]["label"];

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * `color-mix(in srgb, top share, bottom)` for two `#RRGGBB` colours: web's
 * `--accent-subtle-hover` is `color-mix(in srgb, var(--accent-border) 15%,
 * var(--accent-subtle))` (`packages/theme/src/signet.css`), and the phone has
 * no token for it. A colour in any other form (a palette that isn't hex)
 * leaves `bottom` as it is, so a press still draws, just without the step.
 */
export function mixHex(top: string, share: number, bottom: string): string {
  if (!HEX.test(top) || !HEX.test(bottom)) return bottom;
  const channel = (hex: string, i: number) =>
    parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const mixed = [0, 1, 2].map((i) =>
    Math.round(channel(top, i) * share + channel(bottom, i) * (1 - share))
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${mixed.join("").toUpperCase()}`;
}

/**
 * The tinted control: the chapter accent's quiet fill and border, with a
 * bold label in the accent's text tone. It is the recipe web's
 * `buttonVariants({ variant: "tinted" })` draws (`apps/web/components/ui/button.tsx`:
 * `border-accent-border bg-accent-subtle font-bold text-accent-text`), and
 * `components.md` §3's Tinted row, so one module owns it on each platform and
 * the copies can't drift apart (#4206). The chapter picker's house-gold
 * button still spells its own until #4811 moves it here.
 *
 * Its states are §3's too, as web's are:
 * - **Pressed** steps the fill up one, to web's `--accent-subtle-hover`
 *   (the border mixed 15% into the fill), the way web's hover and press do.
 * - **Disabled** is §3's one disabled recipe for every variant: card fill,
 *   neutral hairline, disabled text. Never a dimmed accent chip: opacity dims
 *   label and fill together and lands wherever the chapter's colour happens to
 *   be, which web's button forbids for the same reason.
 *
 * It is for a control, not a state: a selected chip (a reaction you added, a
 * flag you picked), a highlighted card, or the Accent stat chip
 * (`AccentChip`, `components.md` §5) take the same colours for another reason
 * and keep their own styles. Size (height, padding) stays with the caller,
 * as web's `size` does; `labelRole` picks the label's type size, and the
 * recipe sets its weight.
 */
export function tintedControlStyles(
  tokens: SignetTokens,
  brand: Pick<ChapterBranding, "accent" | "accentSubtle" | "accentBorder">,
  labelRole: TypeRole = tokens.typography.role.label,
) {
  return {
    surface: {
      backgroundColor: brand.accentSubtle,
      borderColor: brand.accentBorder,
      borderWidth: 1,
      borderRadius: tokens.radius.control,
    },
    label: {
      ...typeRole({ ...labelRole, weight: tokens.typography.weight.bold }),
      color: brand.accent,
    },
    pressed: {
      backgroundColor: mixHex(brand.accentBorder, 0.15, brand.accentSubtle),
    },
    disabled: {
      backgroundColor: tokens.color.surface.card,
      borderColor: tokens.color.border.hairline,
    },
    disabledLabel: { color: tokens.color.text.disabled },
  };
}
