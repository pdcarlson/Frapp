/**
 * Signet design tokens — the dark-first warm palette.
 *
 * This is an ADDITIVE entrypoint. `apps/web` and `apps/landing` ship the legacy
 * bone/bronze/ink tokens from `tokens.ts` until their own reskin, and the two
 * systems must not mix on one surface, so nothing here is reachable from the
 * existing exports. `apps/mobile` is the first consumer.
 *
 * Values are transcribed from `spec/ui/design-system/foundations.md`, which is
 * canonical, and which in turn transcribes panel 4h of the committed design
 * reference. Hex casing is normalised to uppercase; the spec mixes cases.
 *
 * What is NOT here: the per-chapter accent family. A chapter's accent is
 * generated from a single seed by the accent engine
 * (`spec/ui/design-system/accent-engine.md`, implemented in
 * `@repo/chapter-theme`) and delivered as cached tokens, so it cannot be a
 * constant in this file. House gold is different — it is Signet's own brand
 * color, fixed across every chapter, so it does live here.
 */

import { frappTokens } from "./tokens";

/** Signet is dark-first. The parameter exists so a future light mode widens rather than breaks. */
export type SignetAppearance = "dark";

export type SignetTypeRole = {
  size: number;
  weight: 400 | 600 | 700;
  /**
   * Specified only for `body` (16/25). Panel 4h gives every other role as
   * size/weight with no line height, so the rest are left to the platform
   * default rather than invented here — a Signet type spec may still set them.
   */
  lineHeight?: number;
};

export type SignetTokens = {
  color: {
    /** The neutral ladder. Each step is visibly lighter than the one below; elevation is luminance, never shadow. */
    surface: {
      background: string;
      surface1: string;
      card: string;
      popover: string;
    };
    /** Low-opacity white so a hairline tracks whatever surface it sits on. Fixed-hex borders are banned. */
    border: { hairline: string; input: string };
    text: {
      foreground: string;
      mutedForeground: string;
      muted: string;
      disabled: string;
    };
    /** Status-only. A semantic hue states a fact; it never tints chrome, headings, or illustration. */
    semantic: {
      success: string;
      warning: string;
      destructive: string;
      info: string;
      /** "You were addressed" — @-mention or DM. Never replaced by the chapter accent. */
      mention: string;
      mentionForeground: string;
    };
    /**
     * Signet's own gold. Fixed for every chapter — the Ask/AI surface speaks in
     * Signet's voice, not the tenant's, so these never retint.
     */
    gold: {
      /** The brand gold itself. Also the Signet mark, which never takes a chapter accent. */
      house: string;
      /** Default seed fed to the accent engine when a chapter has not chosen one. */
      seed: string;
      /** Text/icons drawn on `house`. */
      onHouse: string;
      /** The Ask card and Ask entry chip: tinted fill, border, and text. */
      askFill: string;
      askBorder: string;
      askText: string;
    };
  };
  typography: {
    family: { sans: string; mono: string };
    weight: { regular: 400; semibold: 600; bold: 700 };
    role: Record<
      "display" | "headline" | "title" | "body" | "label" | "caption",
      SignetTypeRole
    >;
  };
  /** Roundness signals what kind of surface you are on, so these are graduated, not uniform. */
  radius: {
    control: number;
    card: number;
    cardLarge: number;
    bubble: number;
    bubbleTail: number;
    sheet: number;
    chip: number;
    chipLarge: number;
    navItem: number;
    avatar: string;
  };
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    "2xl": number;
    "3xl": number;
  };
  touch: { minimum: number; button: number; buttonLarge: number; tabBar: number };
  focus: { ringWidth: number; ringOpacity: number };
  /** Carried over from the legacy system. Provisional, not Signet canon — foundations.md §11. */
  motion: (typeof frappTokens)["motion"];
};

const SIGNET_DARK: SignetTokens = {
  color: {
    surface: {
      background: "#0E0D0B",
      surface1: "#171512",
      card: "#1E1B17",
      popover: "#26221C",
    },
    border: {
      hairline: "rgba(255,255,255,0.08)",
      input: "rgba(255,255,255,0.14)",
    },
    text: {
      foreground: "#EDEAE3",
      mutedForeground: "#A9A399",
      muted: "#78716A",
      disabled: "#57534C",
    },
    semantic: {
      success: "#3FB950",
      warning: "#E5A000",
      destructive: "#F85149",
      info: "#2F81F7",
      mention: "#E5484D",
      mentionForeground: "#FFFFFF",
    },
    gold: {
      house: "#EFB63B",
      seed: "#F2B72E",
      onHouse: "#2C2000",
      askFill: "#251E0E",
      askBorder: "#6B5619",
      askText: "#F4CB63",
    },
  },
  typography: {
    // Figtree arrives on mobile with the Phase 2 rebuild; today no brand font is
    // loaded there at all. Mono stays a system stack, never a bundled webfont.
    family: { sans: "Figtree", mono: "var(--font-mono)" },
    weight: { regular: 400, semibold: 600, bold: 700 },
    role: {
      display: { size: 32, weight: 700 },
      headline: { size: 24, weight: 700 },
      title: { size: 18, weight: 600 },
      body: { size: 16, weight: 400, lineHeight: 25 },
      label: { size: 14, weight: 600 },
      caption: { size: 12.5, weight: 400 },
    },
  },
  radius: {
    control: 12,
    card: 14,
    cardLarge: 16,
    bubble: 18,
    bubbleTail: 6,
    sheet: 20,
    chip: 8,
    chipLarge: 10,
    navItem: 10,
    avatar: "50%",
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, "2xl": 32, "3xl": 48 },
  touch: { minimum: 44, button: 46, buttonLarge: 48, tabBar: 56 },
  focus: { ringWidth: 3, ringOpacity: 0.25 },
  motion: frappTokens.motion,
};

export const signetDarkTokens: SignetTokens = SIGNET_DARK;

/** Keyed so a future appearance is a new entry here, not a change at every call site. */
const SIGNET_TOKENS: Record<SignetAppearance, SignetTokens> = {
  dark: SIGNET_DARK,
};

export function getSignetTokens(
  appearance: SignetAppearance = "dark",
): SignetTokens {
  return SIGNET_TOKENS[appearance];
}

/**
 * The same fixed tokens as CSS custom properties, using the names
 * `foundations.md` gives them.
 *
 * Returned as an object rather than shipped as a `.css` file on purpose. A CSS
 * file in this package is one stray `@import` away from cascading into
 * `apps/web`, which must stay pixel-identical; and the first consumer is React
 * Native, which cannot use custom properties at all. This shape matches what
 * `apps/web/lib/hooks/use-chapter-theme.ts` already iterates, so the web reskin
 * can adopt it without a new mechanism.
 *
 * The accent family is absent for the reason given in the file header — it is
 * per-tenant and comes from the engine, not from here.
 */
export function getSignetCssVars(
  appearance: SignetAppearance = "dark",
): Record<string, string> {
  const t = getSignetTokens(appearance);

  return {
    "--background": t.color.surface.background,
    "--surface-1": t.color.surface.surface1,
    "--card": t.color.surface.card,
    "--popover": t.color.surface.popover,

    "--border": t.color.border.hairline,
    "--input": t.color.border.input,

    "--foreground": t.color.text.foreground,
    "--muted-foreground": t.color.text.mutedForeground,
    "--muted": t.color.text.muted,
    "--disabled": t.color.text.disabled,

    "--success": t.color.semantic.success,
    "--warning": t.color.semantic.warning,
    "--destructive": t.color.semantic.destructive,
    "--info": t.color.semantic.info,
    "--mention": t.color.semantic.mention,
    "--mention-foreground": t.color.semantic.mentionForeground,

    "--gold-house": t.color.gold.house,
    "--gold-on-house": t.color.gold.onHouse,
    "--gold-ask-fill": t.color.gold.askFill,
    "--gold-ask-border": t.color.gold.askBorder,
    "--gold-ask-text": t.color.gold.askText,
  };
}
