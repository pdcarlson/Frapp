import type { Config } from "tailwindcss";
import sharedConfig, { colorVar } from "@repo/theme/tailwind";

/*
 * Signet-only Tailwind keys live in this app config, not in the shared preset:
 * the preset still serves the frozen `apps/landing`, whose legacy `globals.css`
 * does not define these tokens, and a preset key reading an undefined token is
 * the silent-no-color failure #1145 documented. They migrate into the shared
 * preset when landing reskins. Static values come from
 * `packages/theme/src/signet.css`; the accent family is overridden per chapter
 * by the accent engine at runtime. `packages/theme/src/signet.css.spec.ts`
 * asserts every token read here is defined there.
 *
 * `darkMode` stays on the class strategy with nothing ever setting the class:
 * Signet is dark-only (the single `:root` block IS the dark theme), so legacy
 * `dark:` variants must stay inert — the Tailwind default `media` strategy
 * would re-activate them for dark-scheme users. Each screen-family slice of
 * #920 deletes its `dark:` variants as it lands.
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
        "accent-subtle": colorVar("--accent-subtle"),
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
        mention: {
          DEFAULT: colorVar("--mention"),
          foreground: colorVar("--mention-foreground"),
        },
        gold: {
          house: colorVar("--gold-house"),
          "on-house": colorVar("--gold-on-house"),
          "ask-fill": colorVar("--gold-ask-fill"),
          "ask-border": colorVar("--gold-ask-border"),
          "ask-text": colorVar("--gold-ask-text"),
        },
      },
      fontFamily: {
        sans: [
          "var(--font-figtree)",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
};

export default config;
