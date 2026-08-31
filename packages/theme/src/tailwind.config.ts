import type { Config } from "tailwindcss";
import { frappTokens } from "./tokens";

const motionDuration = frappTokens.motion.duration;
const motionEasing = frappTokens.motion.easing;

/**
 * Reads a color token straight out of its custom property, whatever format the
 * property holds.
 *
 * Every key below reads its token through here. Tokens in `globals.css` used to
 * be bare HSL triples that the keys wrapped in `hsl(...)`. That wrapper is why
 * per-chapter theming silently did nothing on every surface the preset owns
 * (#1143): the accent engine persists **hex**, so an injected `#C49A3A` under
 * such a name became `hsl(#C49A3A)` — invalid, dropped by the browser, element
 * keeps its default. The same tokens read raw elsewhere had the mirror-image
 * bug: they only resolved once a chapter overrode them, and rendered nothing on
 * the stock triples. Whichever way you looked, half the sites were broken.
 *
 * Every token this reader serves is therefore defined as a complete color value,
 * so hex from the accent engine, `hsl()` from the defaults, and the `rgba()`
 * hairlines the Signet set uses (`getSignetCssVars()`, which cannot be expressed
 * as a triple at all) are all equally valid. The keys chapter branding actually
 * writes went first, in #1143; the #920 groundwork moved the rest, so there is
 * now exactly one convention and no pairing rule to get wrong.
 *
 * **This used to be a function.** Under Tailwind v3 it was a `({ opacityValue })
 * => string` callback that hand-rolled the alpha branch, emitting a bare
 * `var()` for an un-modified utility and a `color-mix(in srgb, …)` for a
 * modified one — because v3 had no other way to apply alpha to a custom
 * property whose format it could not know.
 *
 * v4 dropped function color values entirely; it applies the modifier itself.
 * A function left here is not an error, it is **dropped**: the key vanishes and
 * every utility built on it compiles to nothing. That is #1145's silent
 * no-color failure again, and on the v4 bump it hit every semantic token at
 * once rather than one family — verified by compiling the sheet and grepping
 * it for `.bg-primary`, which is the only way this class of defect ever shows
 * up. So the helper is now what its name always claimed: the token, wrapped in
 * `var()`, as a plain string.
 *
 * What v4 emits in its place is strictly better than what it replaced.
 * `bg-primary` is still a plain `var(--primary)` with no floor at all;
 * `bg-primary/15` becomes `color-mix(in oklab, var(--primary) 15%, transparent)`
 * guarded by `@supports (color: color-mix(in lab, red, red))`, with the opaque
 * `var()` left as the fallback declaration. The v3 helper had no fallback, so
 * below the `color-mix` floor (Chrome 111 / Safari 16.2 / Firefox 113) a
 * modified utility degraded to **no fill**; it now degrades to the un-modified
 * color. The mixing space moves from sRGB to OKLab, which shifts a translucent
 * fill imperceptibly and is Tailwind's own default.
 *
 * The three awkward `opacityValue` shapes the old callback had to special-case
 * are all v4's problem now: the `var(--tw-*-opacity, 1)` sentinel, a `"62%"`
 * string that must not be multiplied, and the literal `0` that
 * `gradientColorStops` passes to synthesise a transparent end-stop (testing it
 * for truthiness turned a fade into a flat block).
 *
 * **Two Signet tokens still carry the `color-mix` floor un-modified.**
 * `--primary-pressed` and `--accent-subtle-hover` are themselves `color-mix()`
 * values (the button states `components.md` §3 names but the accent engine
 * emits no role for), so `bg-primary-pressed` needs `color-mix` support to
 * resolve at all — that is about what the token holds, not about the utility.
 * Below the floor those two degrade to no fill rather than to the un-pressed
 * colour; they are hover/pressed states on controls that are legible without
 * them, which is why they were an acceptable place to spend it. Do not reach
 * for a `color-mix` token for a *rest* state.
 */
export const colorVar = (token: string): string => `var(${token})`;

const config: Partial<Config> = {
  theme: {
    extend: {
      colors: {
        /*
         * Legacy brand scale keys, kept for `apps/landing` — the last surface
         * on this preset's colour values. The KEYS are the pre-rebrand
         * spellings so its existing utility classes keep compiling; the VALUES
         * are the bone / bronze / ink palette. Read "navy" as ink.
         *
         * `royal-blue` (bronze) was deleted in the #920 slice-9 cutover: it had
         * zero class sites anywhere in the repo, and a key with no consumers is
         * deleted rather than kept "in case" (signet-cutover skill). `navy`
         * shed its numbered steps in the same pass for the same reason — every
         * one of its ten call sites uses the bare `text-navy` / `bg-navy`.
         *
         * `tokens.ts` carries the honest names (`ink`, `bronze`, `moss`); its
         * matching deprecated aliases went with #917. These scale keys did not
         * follow, because renaming them means moving the class sites, which is
         * landing-reskin work — and that reskin has no tracked issue of its own
         * (#920 is `apps/web`, #937 is `apps/mobile`). #913/#914, cited here
         * before, are the two `area:product` pricing decisions that *block* it,
         * not the removal ticket.
         *
         * `emerald` is a *partial* override of a stock Tailwind colour, so any
         * step not listed below still resolves to stock Tailwind green. Reach
         * only for a step defined here — #916 was exactly that: `emerald-700`
         * is absent from this block, so the landing pricing pill rendered stock
         * emerald beside a moss `emerald-100` and nothing flagged it.
         */
        navy: {
          DEFAULT: "#1F1A15" /* ink */,
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
         * consumers is deleted, not kept "in case" (signet-cutover skill). The
         * engine that wrote those tokens into `chapters.theme_palette` was
         * itself deleted in the slice-9 cutover; rows written before it keep
         * them as inert jsonb that nothing reads.
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
        /* Also written per chapter, from `--signet-accent-ring`. */
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
