import type { SignetTokens } from "@repo/theme/signet";
import type { ChapterBranding } from "@/lib/chapter-branding";
import { typeRole } from "@/lib/theme";

type TypeRole = SignetTokens["typography"]["role"]["label"];

/**
 * The tinted control: the chapter accent's quiet fill and border, with a
 * bold label in the accent's text tone. It is the recipe web's
 * `buttonVariants({ variant: "tinted" })` draws (`apps/web/components/ui/button.tsx`:
 * `border-accent-border bg-accent-subtle font-bold text-accent-text`), so one
 * module owns it on each platform and the copies can't drift apart (#4206).
 *
 * It is for a control, not a state: a selected chip (a reaction you added, a
 * flag you picked), a highlighted card, or the Accent stat chip
 * (`AccentChip`, `components.md` §5) take the same colours for another reason
 * and keep their own styles. Size (height, padding) stays with the caller,
 * as web's `size` does; `labelRole` picks the label's type size, and the
 * recipe sets its weight.
 *
 * Pressed and disabled are opacity steps, since no token carries a pressed
 * accent-subtle tone on the phone.
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
    pressed: { opacity: 0.7 },
    disabled: { opacity: 0.5 },
  };
}
