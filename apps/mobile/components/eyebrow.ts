import type { SignetTokens } from "@repo/theme/signet";
import { typeRole } from "@/lib/theme";

/**
 * The eyebrow: a section label above a list or a card's title. It is the
 * recipe web's `EYEBROW` (`apps/web/components/ui/typography.ts`) draws,
 * caption (12.5) at 600, uppercase, tracked out 0.12em (1.5 at 12.5), so one
 * module owns it on each platform and the copies can't drift apart. Like web's,
 * it carries no colour: callers pair it with their surface's tone, which is
 * `mutedForeground` in every current consumer.
 */
export function eyebrowStyle(tokens: SignetTokens) {
  return {
    ...typeRole({
      ...tokens.typography.role.caption,
      weight: tokens.typography.weight.semibold,
    }),
    textTransform: "uppercase" as const,
    letterSpacing: 1.5,
  };
}
