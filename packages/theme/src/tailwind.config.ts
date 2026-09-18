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
         * The legacy brand scale keys — `navy` (ink) and the `emerald` (moss)
         * partial override — are GONE, deleted with the #2366 landing token
         * cutover. They existed for exactly one consumer: `apps/landing`, the
         * last surface on this preset's colour VALUES rather than its semantic
         * tokens. That surface now imports `packages/theme/src/signet.css` and
         * its seventeen `text-navy` / `text-emerald-600` / `bg-navy` /
         * `bg-emerald-100` class sites moved to `text-foreground`, `text-success`
         * and the surface ladder in the same change.
         *
         * A key with no consumers is deleted rather than kept "in case"
         * (`.claude/skills/signet-cutover/SKILL.md`: a cutover deletes what it
         * replaces, and a definition is not evidence anything calls it). This
         * is the same pass that took `royal-blue`, the `side-*` family and the
         * `primary` 50–950 ramp — see git history for the values.
         *
         * `tokens.ts` still carries the honest bone/bronze/ink names and stays:
         * `accent.ts` reads `frappTokens.color.brand.bronze` as the accent
         * engine's fallback, and both this file and `signet.ts` read its motion
         * scale. What went is the Tailwind SCALE, not the token module.
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
      /*
       * No `md` key here on purpose. The original reason was that this preset
       * also served the frozen `apps/landing`, whose `globals.css` defined real
       * shadows and no `--shadow-md`; binding `md` here would have made
       * `shadow-md` resolve against an undefined property there and be dropped
       * — the silent failure #1145 documented. #2366 retired that consumer, and
       * both app configs now bind their own `md` to the `none` token, so the
       * key can move up with the rest of the common subset (#2371). Left as-is
       * for now so this PR changes no compiled output. What follows describes
       * the retired arrangement: landing was not Signet and not under the
       * no-shadow ban, so falling through to
       * Tailwind's stock `shadow-md` is the right answer for it.
       *
       * Signet's own `md` binding lives in `apps/web/tailwind.config.ts` with
       * the other Signet-only keys.
       */
      boxShadow: {
        xs: "var(--shadow-xs)",
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow)",
        lg: "var(--shadow-lg)",
      },
      /*
       * Figtree since #2366 took the last surface off Geist. Both consuming
       * apps re-declare `sans` in their own config (they load the font, so they
       * own the variable name), which makes this key a default nothing reaches
       * today — but a preset default naming a typeface the house REJECTED
       * (`brand-identity.md` §3) is a trap for the next surface that adds
       * itself here and does not think to override it.
       */
      fontFamily: {
        sans: ["var(--font-figtree)", "system-ui", "-apple-system", "sans-serif"],
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
