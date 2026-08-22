import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";
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
 *
 * `pointer-coarse` is a **custom variant**, registered below. Tailwind did not
 * ship one until v4 and this workspace is on v3.4, so before the Directory &
 * Finance slice of #920 every `pointer-coarse:` class in the tree compiled to
 * nothing at all: the chat slice's `CHIP_HIT_AREA`
 * (`components/chat/chip.ts`) had been growing reaction chips to the §2 44px
 * floor on touch only in the source. The shipped stylesheet contained zero
 * occurrences of `pointer: coarse`. Unknown variants are dropped silently
 * rather than erroring, which is why it read as working for two slices; it was
 * caught by compiling the sheet and grepping it, not by inspection.
 *
 * Registering it therefore *activates* chat's chips for the first time, which
 * is a cross-surface change riding on a config edit. Measured in Chromium at
 * 375px before shipping it: the reaction chips go from 26px to 44px tall on a
 * coarse pointer, keep their widths, stay on one row and do not overlap — which
 * is exactly what `CHIP_HIT_AREA` was written to do.
 */
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  presets: [sharedConfig],
  darkMode: "class",
  plugins: [
    plugin(({ addVariant }) => {
      /*
       * §2's touch floor applies where the pointer is coarse. This is the other
       * half of the same media feature Tailwind's own `hover:` already consults
       * (`(hover: hover) and (pointer: fine)`), so a control can grow for a
       * finger without growing for a mouse.
       */
      addVariant("pointer-coarse", "@media (pointer: coarse)");
    }),
  ],
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
        // The AA-lifted danger tone for text/icons on a danger tint (§5).
        "destructive-text": colorVar("--destructive-text"),
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
      borderRadius: {
        /*
         * The 20 step — sheets and the AI answer card (foundations.md §8), the
         * ceiling of the map. It lives here rather than in the shared preset
         * for the same reason the colors above do: the legacy stylesheet the
         * frozen landing surface ships defines no `--radius-2xl`, and a preset
         * key reading an undefined token is #1145's silent failure.
         */
        "2xl": "var(--radius-2xl)",
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
