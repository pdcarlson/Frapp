/*
 * Frapp typed design tokens — bone / bronze / ink.
 *
 * Mirrors the CSS variables in `globals.css` so the mobile app, JS-side
 * theming, and any non-Tailwind consumer reach the same palette. CSS
 * variables remain the source of truth for the web app; this file is the
 * source of truth for mobile (which reads through `getFrappTokens()`).
 *
 * Per-chapter overlays (Chunk 2) will replace `brand.bronze` and
 * `sidebar.accent` at runtime via `derivePalette()`. The structure here
 * is the chrome those overlays paint into.
 */

const SHARED_TOKENS = {
  /* tight ledger-style radii: xs 3 / sm 5 / md 7 / lg 9 / xl 12 */
  radius: {
    xs: 3,
    sm: 5,
    md: 7,
    lg: 9,
    xl: 12,
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
  },
  /* dashboard type scale: display 24 / title 18 / section 14 /
     eyebrow 11 / body 14 / meta 13 / mono 13 */
  type: {
    display: 24,
    title: 18,
    section: 14,
    eyebrow: 11,
    body: 14,
    meta: 13,
    label: 12,
    mono: 13,
  },
  motion: {
    duration: {
      micro: 140,
      standard: 220,
      context: 300,
    },
    easing: {
      standard: "cubic-bezier(0.16, 1, 0.3, 1)",
      entrance: "cubic-bezier(0.22, 1, 0.36, 1)",
      exit: "cubic-bezier(0.4, 0, 1, 1)",
    },
  },
} as const;

type FrappColorPalette = {
  brand: {
    /* Renamed conceptually from "navy" to "ink" — keys kept stable so
       mobile consumers do not have to re-import. Values now map to the
       bone/bronze/ink palette. */
    navy: string;
    royalBlue: string;
    emerald: string;
  };
  surface: {
    canvas: string;
    card: string;
    muted: string;
    border: string;
  };
  text: {
    primary: string;
    secondary: string;
    muted: string;
    inverse: string;
  };
  sidebar: {
    background: string;
    backgroundHi: string;
    foreground: string;
    foregroundHi: string;
    muted: string;
    divider: string;
    accent: string;
  };
  feedback: {
    successBackground: string;
    successBorder: string;
    successText: string;
    infoBackground: string;
    infoBorder: string;
    infoText: string;
    infoTextStrong: string;
    infoBackgroundStrong: string;
    infoBorderStrong: string;
    infoTextInteractive: string;
    warningBackground: string;
    warningBorder: string;
    warningText: string;
    errorBackground: string;
    errorBorder: string;
    errorText: string;
  };
};

export type FrappTokens = {
  color: FrappColorPalette;
} & typeof SHARED_TOKENS;

const LIGHT_COLORS: FrappColorPalette = {
  brand: {
    navy: "#1F1A15", /* ink — deep warm near-black */
    royalBlue: "#7A5A2F", /* deep bronze — replaces royal blue */
    emerald: "#3D6B4A", /* moss — replaces emerald */
  },
  surface: {
    canvas: "#FAF7F2", /* bone */
    card: "#FFFFFF",
    muted: "#F2EEE7", /* warm stone */
    border: "#E4DED4",
  },
  text: {
    primary: "#1F1A15", /* ink */
    secondary: "#5C544A",
    muted: "#7C7468",
    inverse: "#FAF7F2",
  },
  sidebar: {
    background: "#1C1813",
    backgroundHi: "#2A241D",
    foreground: "#B8B1A4",
    foregroundHi: "#F4F0E8",
    muted: "#8B8276",
    divider: "#2F2922",
    accent: "#CBA876", /* bone-bronze sidebar highlight */
  },
  feedback: {
    successBackground: "#E6F0E4",
    successBorder: "#BBD3B8",
    successText: "#264D33",
    infoBackground: "#F0EBE0",
    infoBorder: "#D6CBB3",
    infoText: "#5C4A2B",
    infoTextStrong: "#3D2F18",
    infoBackgroundStrong: "#E5DCC6",
    infoBorderStrong: "#B89A6B",
    infoTextInteractive: "#7A5A2F",
    warningBackground: "#FBEFD8",
    warningBorder: "#F0DAA5",
    warningText: "#7A4C13",
    errorBackground: "#FBE7DF",
    errorBorder: "#F2C5B3",
    errorText: "#9A3315",
  },
};

const DARK_COLORS: FrappColorPalette = {
  brand: {
    navy: "#1A1611",
    royalBlue: "#D6B988", /* bone-bronze, legible on dark */
    emerald: "#7DB58E",
  },
  surface: {
    canvas: "#181410",
    card: "#221E18",
    muted: "#1E1A15",
    border: "#363028",
  },
  text: {
    primary: "#F4F0E8",
    secondary: "#C7BFB1",
    muted: "#9B9388",
    inverse: "#1F1A15",
  },
  sidebar: {
    background: "#0F0C09",
    backgroundHi: "#181410",
    foreground: "#B8B1A4",
    foregroundHi: "#F4F0E8",
    muted: "#85796B",
    divider: "#181410",
    accent: "#D6B988",
  },
  feedback: {
    successBackground: "#1A2A1E",
    successBorder: "#2D4D38",
    successText: "#9BCBA7",
    infoBackground: "#2A241B",
    infoBorder: "#4A3E2D",
    infoText: "#D6BD93",
    infoTextStrong: "#E8D4AF",
    infoBackgroundStrong: "#3A2F1F",
    infoBorderStrong: "#7A5F38",
    infoTextInteractive: "#D6B988",
    warningBackground: "#2A1F11",
    warningBorder: "#4A3818",
    warningText: "#E8C68E",
    errorBackground: "#2A1812",
    errorBorder: "#5A2A1E",
    errorText: "#E8A88E",
  },
};

export const frappLightTokens: FrappTokens = {
  color: LIGHT_COLORS,
  ...SHARED_TOKENS,
};

export const frappDarkTokens: FrappTokens = {
  color: DARK_COLORS,
  ...SHARED_TOKENS,
};

export type FrappColorMode = "light" | "dark";

export function getFrappTokens(mode: FrappColorMode): FrappTokens {
  return mode === "dark" ? frappDarkTokens : frappLightTokens;
}

export const frappTokens = frappLightTokens;
