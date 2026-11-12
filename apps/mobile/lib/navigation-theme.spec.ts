import { describe, expect, test } from "vitest";
import { signetDarkTokens } from "@repo/theme/signet";
import { navigationThemeFor } from "./navigation-theme";

describe("navigationThemeFor (#3699)", () => {
  test("every surface a navigator paints is the app's background, never the light default", () => {
    const theme = navigationThemeFor(signetDarkTokens);
    expect(theme.dark).toBe(true);
    expect(theme.colors.background).toBe(
      signetDarkTokens.color.surface.background,
    );
    expect(theme.colors.card).toBe(signetDarkTokens.color.surface.background);
  });
});
