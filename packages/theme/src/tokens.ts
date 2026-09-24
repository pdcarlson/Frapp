/*
 * Frapp typed design tokens — bone / bronze / ink.
 *
 * Mirrored the CSS variables in `globals.css` — deleted with the landing
 * cutover (#2366) — so the mobile app, JS-side theming and any non-Tailwind
 * consumer reached the same palette. Both halves of that arrangement are
 * retired: no stylesheet, and no surface reading these values.
 *
 * This is the legacy Frapp palette and **no surface consumes it** any more:
 * `apps/web` and `apps/mobile` ship Signet (`./signet.ts`), and `apps/landing`
 * cut over with #2366, which deleted `globals.css` and both package exports.
 * The module stays because two live things read it INSIDE this package — the
 * accent engine's bronze fallback in `accent.ts`, and the motion scale that
 * `signet.ts` and the Tailwind preset both import. Do not wire a surface to it. Chapter branding no
 * longer overlays these values at all: the Signet accent engine derives its
 * roles from one seed into `--signet-*` custom properties, and the neutral
 * ladder is fixed (`spec/ui/design-system/accent-engine.md` §5).
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

/**
 * The three brand colors, under their real names.
 *
 * #911 added `navy` / `royalBlue` / `emerald` aliases holding byte-identical
 * values, because the pre-rebrand spellings were still on call sites. #917
 * removed them in the #920 slice-9 cutover: they were misnamed (`navy` has held
 * a warm near-black since the bone/bronze rebrand, `royalBlue` a deep bronze,
 * `emerald` a moss green) and by then had zero consumers anywhere in the repo.
 *
 * The Tailwind preset in `./tailwind.config.ts` keeps its own separate `navy`
 * and `emerald` *scale* keys — those are class-site-bound and `apps/landing`
 * still uses them. They are a different surface, not these aliases.
 */
type FrappBrandPalette = {
  /** Warm near-black. The darkest neutral in the palette. */
  ink: string;
  /** Deep bronze — the platform accent, and the fallback when a chapter's fails. */
  bronze: string;
  /** Muted green, used for positive and success states. */
  moss: string;
};

function brandPalette(
  ink: string,
  bronze: string,
  moss: string,
): FrappBrandPalette {
  return { ink, bronze, moss };
}

type FrappColorPalette = {
  brand: FrappBrandPalette;
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
  brand: brandPalette("#1F1A15", "#7A5A2F", "#3D6B4A"),
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

export const frappLightTokens: FrappTokens = {
  color: LIGHT_COLORS,
  ...SHARED_TOKENS,
};

export const frappTokens = frappLightTokens;
