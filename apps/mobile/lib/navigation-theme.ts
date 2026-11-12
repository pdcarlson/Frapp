import { DarkTheme, type Theme } from "expo-router";
import type { SignetTokens } from "@repo/theme/signet";

/**
 * The theme every navigator in the app paints its own surfaces from.
 *
 * Without one, expo-router hands its navigators React Navigation's light
 * `DefaultTheme`, and they paint from it wherever no screen covers them: the
 * native stack's container and each screen's card behind its content, and the
 * tab navigator's scene behind each tab. A back swipe uncovers exactly those,
 * so the edge of the screen being swiped away showed a pale grey strip rather
 * than the app's near-black (#3699). Signet is dark-only, so every surface a
 * navigator draws is the app's background, its cards the card step, and its
 * hairlines the hairline (`spec/ui/design-system/foundations.md`).
 *
 * No screen shows a navigator's header (`app/(app)/_layout.tsx`), so `card`,
 * `text` and `primary` are set for completeness, not because one is drawn.
 */
export function navigationThemeFor(tokens: SignetTokens): Theme {
  return {
    ...DarkTheme,
    dark: true,
    colors: {
      ...DarkTheme.colors,
      background: tokens.color.surface.background,
      card: tokens.color.surface.background,
      text: tokens.color.text.foreground,
      border: tokens.color.border.hairline,
      primary: tokens.color.text.foreground,
      notification: tokens.color.semantic.mention,
    },
  };
}
