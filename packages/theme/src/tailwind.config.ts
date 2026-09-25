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
 * What v4 emits in its place is better than what it replaced, with one
 * exception. `bg-primary` is still a plain `var(--primary)` with no floor at
 * all; `bg-primary/15` becomes `color-mix(in oklab, var(--primary) 15%,
 * transparent)` guarded by `@supports (color: color-mix(in lab, red, red))`,
 * with the opaque `var()` left as the fallback declaration. The v3 helper had
 * no fallback, so below the `color-mix` floor (Chrome 111 / Safari 16.2 /
 * Firefox 113) a modified utility degraded to **no fill**; it now degrades to
 * the un-modified color. The mixing space moves from sRGB to OKLab, which
 * shifts a translucent fill imperceptibly and is Tailwind's own default.
 *
 * **The exception is a fill whose text is the same hue** — which is exactly
 * foundations §5's tint recipe. There the un-modified fallback is the text's
 * own colour, and the label reads 1.00:1 (#2376). Degrading to the solid is
 * worse than degrading to nothing for that pair, so the recipe does not use a
 * modifier at all: it has opaque tokens (`bg-success-tint`, `bg-warning-tint`,
 * `bg-destructive-tint`, `hover:bg-destructive-tint-hover`) resolved to
 * literals in `signet.css`, and `status-tint-call-sites.spec.ts` in
 * `apps/web` fails on a `bg-<semantic>/<alpha>` fill anywhere in the Next
 * surfaces. A modifier elsewhere (a border, the accent tints) still degrades
 * to a bolder colour, which is cosmetic and accepted.
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
          // §5's tint recipe as an opaque fill; never `bg-success/[.13]`
          // (see the `colorVar` docstring and `signet.css`).
          tint: colorVar("--success-tint"),
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
          tint: colorVar("--destructive-tint"),
          "tint-hover": colorVar("--destructive-tint-hover"),
        },
        border: colorVar("--border"),
        input: colorVar("--input"),
        /* Also written per chapter, from `--signet-accent-ring`. */
        ring: colorVar("--ring"),

        /* ── The Signet keys both surfaces bind (#2371) ──────────────────
         *
         * These sat in `apps/web/tailwind.config.ts` and, after #2366,
         * identically in `apps/landing/tailwind.config.ts`. They lived
         * app-local because this preset also served the frozen landing,
         * whose legacy `globals.css` defined none of these tokens, and a
         * preset key reading an undefined property is #1145's silent
         * no-color failure. Both surfaces ship `signet.css` now, so every
         * token below is defined for every consumer of this preset and the
         * two homes were pure duplication.
         *
         * What stays app-local, and why it is not an oversight: the `gold`
         * family is an `apps/web` treatment (the Ask pill), and the
         * landing's three marketing type roles sit deliberately ABOVE the
         * locked six (`foundations.md` §7 amendment). Promoting either
         * would claim a treatment the other surface does not implement.
         */
        "surface-1": colorVar("--surface-1"),
        "primary-hover": colorVar("--primary-hover"),
        "primary-pressed": colorVar("--primary-pressed"),
        "accent-subtle": colorVar("--accent-subtle"),
        "accent-subtle-hover": colorVar("--accent-subtle-hover"),
        "accent-border": colorVar("--accent-border"),
        "accent-text": colorVar("--accent-text"),
        disabled: colorVar("--disabled"),
        warning: {
          DEFAULT: colorVar("--warning"),
          foreground: colorVar("--warning-foreground"),
          tint: colorVar("--warning-tint"),
        },
        info: {
          DEFAULT: colorVar("--info"),
          foreground: colorVar("--info-foreground"),
        },
        // The AA-lifted danger tone for text/icons on a danger tint (§5).
        "destructive-text": colorVar("--destructive-text"),
        // Its info twin, added with the greenfield ladder: solid `--info`
        // fell under 4.5:1 on `--card` and `--popover` when the ladder
        // lightened. Without this key the token would be declared in
        // `signet.css`, documented in foundations §5, and unreachable from any
        // component — the token guards run preset -> CSS, never CSS -> preset,
        // so nothing fails when a declared token has no key to reach it by.
        "info-text": colorVar("--info-text"),
        /*
         * "You were addressed". Both halves are needed: `mention` /
         * `mention-foreground` is the unread DM badge, and `chip` /
         * `chip-text` is the in-bubble treatment, which is deliberately NOT
         * the mention red (§5 — red as text inside a bubble is the case that
         * pair exists for). All four are CSS-only tokens: `signetDarkTokens`
         * is what `apps/mobile` reads, and mobile draws no in-bubble mention
         * highlight, but mobile does not consume this preset — only the two
         * Next surfaces do, and since #2367 both draw the chip.
         */
        mention: {
          DEFAULT: colorVar("--mention"),
          foreground: colorVar("--mention-foreground"),
          chip: colorVar("--mention-chip"),
          "chip-text": colorVar("--mention-chip-text"),
        },
      },
      borderRadius: {
        xs: "var(--radius-xs)",
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        /*
         * The 20 step — sheets and the AI answer card (foundations.md §8),
         * the ceiling of the map. App-local until #2371 for the same
         * expired #1145 reason as the colors above.
         */
        "2xl": "var(--radius-2xl)",
      },
      /*
       * `md` is bound here like every other step, as of #2371. It was the one
       * key this preset deliberately left unbound, because the preset also
       * served the frozen `apps/landing`, whose legacy `globals.css` defined
       * real shadows and no `--shadow-md`: binding it here would have made
       * `shadow-md` resolve against an undefined property on that surface and
       * be dropped — #1145's silent failure. #2366 retired that consumer and
       * `signet.css` defines `--shadow-md: none`, so the reason has lapsed.
       *
       * Leaving it unbound is not the safe default it looks like. Every other
       * `shadow-*` utility resolves to a token that is `none`; an UNBOUND key
       * does not inherit that, it falls through to Tailwind's stock scale and
       * compiles a real drop shadow, past the §10 ban everyone believed the
       * `none` tokens enforced.
       */
      boxShadow: {
        xs: "var(--shadow-xs)",
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
      /*
       * The Signet type scale (foundations.md §7) as real utilities. Tailwind
       * has no equivalent — its `text-sm`/`text-base` ladder is a different
       * system — so without these keys the six roles are CSS custom properties
       * no component can reach, and screens keep writing `text-[12.5px]`.
       *
       * Each key pairs its size with the role's line height and weight, so
       * `text-body` carries 16px/25px/400 rather than only the size.
       *
       * Sizes and weights are read from the custom properties. **Line heights
       * are not, and cannot be for five of the six roles:** `foundations.md` §7
       * states only `--text-body-line` (25px) — it calls that "the only one the
       * scale states" — so `display` / `headline` / `title` / `label` /
       * `caption` carry literals here that the type scale does not define.
       * Those five values were chosen when these utilities landed, not derived
       * from the spec, and `signet.css` is therefore *not* the one place they
       * are written. Tracked as L-09 in `spec/ui/web-greenfield/tokens.md`;
       * settle them there (or in §7) rather than editing one literal in place.
       *
       * `apps/landing` adds three MARKETING roles on top of these six, in its
       * own config. They sit deliberately above the locked scale
       * (`foundations.md` §7 amendment) and must not be promoted here: that
       * would put a 72px marketing headline one import away from every product
       * screen. `signet.spec.ts` guards the amendment.
       */
      fontSize: {
        display: [
          "var(--text-display)",
          { lineHeight: "1.15", fontWeight: "var(--text-display-weight)" },
        ],
        headline: [
          "var(--text-headline)",
          { lineHeight: "1.2", fontWeight: "var(--text-headline-weight)" },
        ],
        title: [
          "var(--text-title)",
          { lineHeight: "1.3", fontWeight: "var(--text-title-weight)" },
        ],
        body: [
          "var(--text-body)",
          {
            lineHeight: "var(--text-body-line)",
            fontWeight: "var(--text-body-weight)",
          },
        ],
        label: [
          "var(--text-label)",
          { lineHeight: "1.3", fontWeight: "var(--text-label-weight)" },
        ],
        caption: [
          "var(--text-caption)",
          { lineHeight: "1.35", fontWeight: "var(--text-caption-weight)" },
        ],
      },
      /*
       * Touch floors (foundations.md §9). `min-h-touch` is the 44px minimum the
       * spec binds on every platform; `min-h-button` is the standard control
       * height. Tailwind's numeric scale can express both, but not by name, and
       * the name is the point — a reviewer can see the floor being honored.
       *
       * Deliberately NOT here: the `--space-*` grid. Tailwind's own spacing
       * scale is already this 4px grid (`p-2` is 8px, `gap-4` is 16px), so a
       * second named spelling would be a parallel token set on one surface,
       * which `.claude/skills/signet-cutover/SKILL.md` bans. The custom
       * properties exist for hand-written CSS and for parity with the mobile
       * token source, not to replace `p-4`.
       */
      minHeight: {
        touch: "var(--touch-min)",
        button: "var(--touch-button)",
      },
      minWidth: {
        touch: "var(--touch-min)",
      },
      /*
       * Figtree since #2366 took the last surface off Geist. Both consuming
       * apps used to re-declare `sans` in their own config; #2371 deleted those
       * two redundant copies, so this is now the one place the stack is
       * written. A preset default naming a typeface the house REJECTED
       * (`brand-identity.md` §3) would be a trap for the next surface that adds
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
