import type { Config } from "tailwindcss";
import { frappTokens } from "./tokens";

const motionDuration = frappTokens.motion.duration;
const motionEasing = frappTokens.motion.easing;

/**
 * Reads a color token straight out of its custom property, whatever format the
 * property holds.
 *
 * Every key below reads its token through here. Tokens in `globals.css` used to
 * be bare HSL triples that the keys wrapped in
 * `hsl(...)`. That wrapper is why per-chapter theming silently did nothing on
 * every surface the preset owns (#1143): `derivePalette()` persists **hex**, so
 * an injected `--side-accent: #C49A3A` became `hsl(#C49A3A)` — invalid, dropped
 * by the browser, element keeps its default. The same tokens read raw elsewhere
 * (`border-[color:var(--side-accent)]` in the chat renderers) had the mirror-image
 * bug: they only resolved once a chapter overrode them, and rendered nothing on
 * the stock triples. Whichever way you looked, half the sites were broken.
 *
 * Every token this reader serves is therefore defined as a complete color value,
 * so hex from the accent engine, `hsl()` from the defaults, and the `rgba()`
 * hairlines the Signet set uses (`getSignetCssVars()`, which cannot be expressed
 * as a triple at all) are all equally valid. The `--ring` / `--side-*` keys went
 * first, in #1143, because they are the ones chapter branding actually writes;
 * the #920 groundwork moved the rest, so there is now exactly one convention and
 * no pairing rule to get wrong.
 *
 * `color-mix` only appears when a class asks for one — `bg-primary/15` — so
 * the common case still compiles to a plain `var()`. Tailwind hands this
 * function `var(--tw-bg-opacity, 1)` for an un-modified utility; that path is
 * deliberately collapsed to the bare variable, which drops support for the
 * legacy `bg-opacity-70` form. Nothing in the repo uses it.
 *
 * Three shapes of `opacityValue` arrive, and they are not interchangeable:
 * `undefined` (`toColorValue`), the string `var(--tw-*-opacity, 1)` (an
 * un-modified utility), an explicit `"0.7"` or `"62%"` (a modifier), and the
 * **number** `0` — which `gradientColorStops` passes to synthesise the implicit
 * transparent end-stop of `from-*` / `via-*`. Testing truthiness would send that
 * `0` down the no-modifier branch and emit an opaque stop, turning a fade into a
 * flat block; a percentage needs to be used as-is, because `calc(62% * 100%)`
 * is not a valid product and the browser drops the whole declaration.
 *
 * **Browser floor.** `color-mix` needs Chrome 111 / Safari 16.2 / Firefox 113,
 * where `hsl(var(--x) / a)` needed only Safari 12.1. It applies to every
 * utility that carries an **opacity modifier** (`bg-primary/10`,
 * `border-destructive/30`, `ring-side-accent/70`); an un-modified utility
 * compiles to a plain `var()` and has no floor at all. Those degrade to no
 * fill on an older engine.
 *
 * The floor was scoped to the fourteen `side-*` classes (a family since
 * deleted with the #920 shell cutover) while they were the only keys here.
 * Converting the rest of the preset (#920 groundwork) widened it to every
 * token: measured against the real `apps/web` and `apps/landing` class
 * corpus, compiled `color-mix` declarations went from **7** to **57**.
 *
 * It is the same trade Tailwind v4 makes for every colour, and it is the price
 * of a token that can hold hex, `hsl()` or `rgba()`; there is no pre-`color-mix`
 * way to apply alpha to a custom property of unknown format. Signet's `rgba()`
 * hairlines make that format-agnostic reader mandatory, so the floor is not
 * separable from the cutover.
 */
export const colorVar = (token: string): string =>
  // Tailwind resolves a function color value at runtime and documents the form,
  // but `Config` types every colour as a plain `string`, so there is no way to
  // express this without a cast. It is the type stub being narrower than the
  // library, not an unsound claim: `tailwind.config.spec.ts` calls these back
  // and asserts what they emit across all four shapes above.
  ((({ opacityValue }: { opacityValue?: string | number } = {}) => {
    if (
      opacityValue === undefined ||
      (typeof opacityValue === "string" && opacityValue.startsWith("var(--tw-"))
    ) {
      return `var(${token})`;
    }
    const amount =
      typeof opacityValue === "string" && opacityValue.endsWith("%")
        ? opacityValue
        : `calc(${opacityValue} * 100%)`;
    return `color-mix(in srgb, var(${token}) ${amount}, transparent)`;
  }) as unknown as string);

const config: Partial<Config> = {
  theme: {
    extend: {
      colors: {
        /*
         * Named brand colors (for direct use: text-navy, bg-royal-blue,
         * etc.). The KEYS are preserved so existing utility classes
         * (`text-navy-900`, `bg-royal-blue`) keep compiling, but the
         * VALUES now map to the bone / bronze / ink palette. Mark the
         * "navy" key as ink and "royal-blue" as bronze in your mental
         * model — the chat-first redesign no longer ships with blue.
         *
         * The TS tokens in `tokens.ts` now carry honest names (`ink`,
         * `bronze`, `moss`) with the old ones kept as deprecated aliases.
         * These Tailwind scale keys deliberately did NOT follow, and adding
         * honest aliases here would be worse than leaving them: `emerald`
         * overrides only DEFAULT/50/100/400/500/600, so `emerald-300`,
         * `emerald-700`, and `emerald-900` — all in live use — fall through
         * to stock Tailwind green. A `moss` alias built from the five
         * overridden steps would therefore render `moss-700` at a different
         * color than `emerald-700`. Renaming these is web/landing reskin
         * work, done when the class sites move with them.
         */
        navy: {
          DEFAULT: "#1F1A15", /* ink */
          50: "#FAF7F2",
          100: "#F2EEE7",
          800: "#2A241D",
          900: "#1F1A15",
          950: "#0F0C09",
        },
        "royal-blue": {
          DEFAULT: "#7A5A2F", /* bronze */
          50: "#F5EFE3",
          100: "#E5DCC6",
          400: "#B89A6B",
          500: "#9A7A45",
          600: "#7A5A2F",
          700: "#5C4423",
        },
        emerald: {
          DEFAULT: "#3D6B4A", /* moss */
          50: "#E6F0E4",
          100: "#CFE0CC",
          400: "#6E9C7B",
          500: "#52805F",
          600: "#3D6B4A",
        },
        /*
         * The `side-*` sidebar family is gone. It existed for the legacy web
         * dashboard's always-dark-ink sidebar; the #920 Signet shell replaced
         * that sidebar with the fixed neutral ladder plus engine accent roles,
         * `apps/landing` never used a `side-*` class, and a key with zero
         * consumers is deleted, not kept "in case" (signet-cutover skill).
         * `derivePalette` still persists `--side-bg`/`--side-accent` into
         * stored `theme_palette` rows until the legacy engine is removed;
         * nothing reads them through the preset any more.
         */

        /* ── Semantic tokens (mapped to CSS variables for ShadCN compatibility) ── */
        background: colorVar("--background"),
        foreground: colorVar("--foreground"),
        card: {
          DEFAULT: colorVar("--card"),
          foreground: colorVar("--card-foreground"),
        },
        popover: {
          DEFAULT: colorVar("--popover"),
          foreground: colorVar("--popover-foreground"),
        },
        /*
         * The 50–950 ramp is gone: its only class consumers were five
         * `bg-primary-50` call sites in `apps/web`, retargeted to the accent
         * tint tokens by the #920 shell slice, and `apps/landing` never used
         * any step. Under Signet the graded accent family comes from the
         * chapter accent engine's role tokens, not a static ramp.
         */
        primary: {
          DEFAULT: colorVar("--primary"),
          foreground: colorVar("--primary-foreground"),
        },
        success: {
          DEFAULT: colorVar("--success"),
          foreground: colorVar("--success-foreground"),
        },
        muted: {
          DEFAULT: colorVar("--muted"),
          foreground: colorVar("--muted-foreground"),
        },
        /*
         * Present because the ShadCN scaffold's `secondary` variants use it and
         * ~20 call sites use those variants. Without this key the classes
         * compiled to nothing (#1145).
         */
        secondary: {
          DEFAULT: colorVar("--secondary"),
          foreground: colorVar("--secondary-foreground"),
        },
        accent: {
          DEFAULT: colorVar("--accent"),
          foreground: colorVar("--accent-foreground"),
        },
        destructive: {
          DEFAULT: colorVar("--destructive"),
          foreground: colorVar("--destructive-foreground"),
        },
        border: colorVar("--border"),
        input: colorVar("--input"),
        /* Also written per chapter by `derivePalette()`. */
        ring: colorVar("--ring"),
      },
      borderRadius: {
        xs: "var(--radius-xs)",
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
      },
      boxShadow: {
        xs: "var(--shadow-xs)",
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow)",
        lg: "var(--shadow-lg)",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "-apple-system", "sans-serif"],
        mono: ["var(--font-mono)"],
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "count-up": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-down": {
          "0%": { opacity: "0", transform: "translateY(-100%)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in-right": {
          "0%": { opacity: "0", transform: "translateX(100%)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
      },
      animation: {
        "fade-up": `fade-up ${motionDuration.context}ms ${motionEasing.standard} forwards`,
        "fade-in": `fade-in ${motionDuration.standard}ms ${motionEasing.standard} forwards`,
        "count-up": `count-up ${motionDuration.standard}ms ${motionEasing.standard} forwards`,
        "slide-down": `slide-down ${motionDuration.context}ms ${motionEasing.entrance} forwards`,
        "slide-in-right": `slide-in-right ${motionDuration.context}ms ${motionEasing.entrance} forwards`,
      },
    },
  },
};

export default config;
