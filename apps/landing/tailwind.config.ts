import type { Config } from "tailwindcss";
import sharedConfig, { colorVar } from "@repo/theme/tailwind";

/*
 * The landing surface on the Signet scale, since the #2366 token cutover.
 *
 * Shape mirrors `apps/web/tailwind.config.ts` deliberately: the Signet-only
 * keys sit in the app config rather than the shared preset, because the preset
 * binds nothing that its stylesheet does not define and a preset key reading an
 * undefined token is #1145's silent no-color failure. Both surfaces now ship
 * `packages/theme/src/signet.css`, so the two key sets are the same set — that
 * duplication is the next thing to collapse, and it is a `@repo/theme` refactor
 * (the preset's contract test is written against the legacy stylesheet) rather
 * than landing work, so it is filed rather than smuggled in here.
 *
 * `darkMode` stays on the class strategy with nothing setting the class, for
 * the same reason `apps/web` does: Signet is dark-only — the single `:root` IS
 * the dark theme — so any legacy `dark:` variant must stay inert rather than
 * re-activating under the Tailwind default `media` strategy. This PR deleted
 * the landing's `dark:` variants; the strategy stays pinned so a reintroduced
 * one cannot quietly paint.
 *
 * The three marketing type roles (`--text-hero`, `--text-display-lg`,
 * `--text-lead`) are declared in `app/globals.css` and bound as real utilities
 * below. They are landing-only by design — see the note in that file.
 */
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  presets: [sharedConfig],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
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
        },
        info: {
          DEFAULT: colorVar("--info"),
          foreground: colorVar("--info-foreground"),
        },
        "destructive-text": colorVar("--destructive-text"),
        "info-text": colorVar("--info-text"),
      },
      /*
       * The six locked roles (foundations.md §7) plus the three marketing roles
       * this surface adds above them. Same construction as `apps/web`: each key
       * pairs its size with the role's line height and weight, so `text-body`
       * carries 16/25/400 rather than only the size.
       *
       * The marketing three state their own line height and tracking as tokens,
       * which the locked six mostly cannot — §7 states a line height only for
       * `body`, so the other five carry literals here exactly as they do in the
       * web config (tracked as L-09 in `spec/ui/web-greenfield/tokens.md`; do
       * not settle it by editing one literal in place).
       */
      fontSize: {
        hero: [
          "var(--text-hero)",
          {
            lineHeight: "var(--text-hero-line)",
            fontWeight: "var(--text-hero-weight)",
            letterSpacing: "var(--text-hero-tracking)",
          },
        ],
        "display-lg": [
          "var(--text-display-lg)",
          {
            lineHeight: "var(--text-display-lg-line)",
            fontWeight: "var(--text-display-lg-weight)",
            letterSpacing: "var(--text-display-lg-tracking)",
          },
        ],
        lead: [
          "var(--text-lead)",
          {
            lineHeight: "var(--text-lead-line)",
            fontWeight: "var(--text-lead-weight)",
          },
        ],
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
      minHeight: {
        touch: "var(--touch-min)",
        button: "var(--touch-button)",
      },
      minWidth: {
        touch: "var(--touch-min)",
      },
      borderRadius: {
        "2xl": "var(--radius-2xl)",
      },
      /*
       * Shadows are banned on Signet surfaces (foundations.md §10) and
       * `signet.css` neutralizes every shadow token to `none`. `md` is the one
       * key the shared preset leaves unbound — it did so because the legacy
       * landing stylesheet had no `--shadow-md` and an unbound key falls
       * through to Tailwind's stock scale and compiles a REAL drop shadow.
       * That is now a live risk on this surface rather than a correct
       * fallthrough, so it is bound here exactly as `apps/web` binds it.
       */
      boxShadow: {
        md: "var(--shadow-md)",
      },
      fontFamily: {
        sans: [
          "var(--font-figtree)",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
      },
    },
  },
};

export default config;
