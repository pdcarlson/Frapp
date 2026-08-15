import { createContext, useContext, useMemo } from "react";
import { Platform } from "react-native";
import type { TextStyle } from "react-native";
import {
  getSignetTokens,
  SignetTokens,
  SignetTypeRole,
} from "@repo/theme/signet";

/**
 * Signet is dark-only by design (`SignetAppearance = "dark"`), so the previous
 * system/light/dark preference machinery is gone with the Phase 2 cutover.
 * The old AsyncStorage key `frapp.mobile.theme-preference` is orphaned on
 * existing installs; it is never read again and small enough not to migrate.
 */
type FrappThemeContextValue = {
  tokens: SignetTokens;
};

const FrappThemeContext = createContext<FrappThemeContextValue | null>(null);

/**
 * Figtree ships as one static TTF per weight, registered by expo-font under
 * these names. Android cannot select a static font's weight through
 * `fontWeight` alone, so every text style must carry the per-weight family —
 * which is why `typeRole` below is the only sanctioned way to set type.
 */
export const FIGTREE_FAMILY: Record<400 | 600 | 700, string> = {
  400: "Figtree_400Regular",
  600: "Figtree_600SemiBold",
  700: "Figtree_700Bold",
};

export function fontFamilyFor(weight: 400 | 600 | 700): string {
  return FIGTREE_FAMILY[weight];
}

/**
 * Signet's mono role is a system stack, never a bundled webfont
 * (foundations.md §7). The token string is a CSS variable and invalid in
 * React Native, so the native stack is resolved here instead.
 */
export const MONO_FONT_FAMILY = Platform.select({
  ios: "Menlo",
  default: "monospace",
});

/**
 * A type role token as a complete RN text style. Screens compose
 * `...typeRole(tokens.typography.role.body)` instead of hand-picking sizes or
 * weights — arithmetic on a role token (e.g. `size - 2`) is a defect per
 * foundations.md §7, exactly as a raw hex value is.
 */
export function typeRole(role: SignetTypeRole): TextStyle {
  return {
    fontSize: role.size,
    fontWeight: String(role.weight) as TextStyle["fontWeight"],
    fontFamily: FIGTREE_FAMILY[role.weight],
    ...(role.lineHeight !== undefined ? { lineHeight: role.lineHeight } : {}),
  };
}

/**
 * A semantic hue as a translucent fill. On dark surfaces Signet status colors
 * paint as tints, not solids: ~13% opacity of the hue as background, with the
 * hue itself (or a lightened step) as text (foundations.md §5). Border tints
 * conventionally use 0.3.
 */
export function tint(hex: string, alpha = 0.13): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * `radius.avatar` is the string "50%", which does not unify with the numeric
 * radii in a StyleSheet factory — avatars pass their size here instead.
 */
export function avatarRadius(size: number): number {
  return size / 2;
}

export function FrappThemeProvider({ children }: { children: React.ReactNode }) {
  const value = useMemo(() => ({ tokens: getSignetTokens("dark") }), []);

  return (
    <FrappThemeContext.Provider value={value}>
      {children}
    </FrappThemeContext.Provider>
  );
}

export function useFrappTheme() {
  const context = useContext(FrappThemeContext);

  if (!context) {
    throw new Error("useFrappTheme must be used within FrappThemeProvider.");
  }

  return context;
}
