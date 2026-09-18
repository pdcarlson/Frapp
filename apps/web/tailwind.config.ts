import type { Config } from "tailwindcss";
import sharedConfig, { colorVar } from "@repo/theme/tailwind";

/*
 * Signet's Tailwind keys live in the shared preset
 * (`packages/theme/src/tailwind.config.ts`) as of #2371. They used to sit in
 * this file, because the preset also served the frozen `apps/landing`, whose
 * legacy `globals.css` defined none of these tokens, and a preset key reading
 * an undefined token is the silent-no-color failure #1145 documented. #2366
 * retired that consumer — landing ships `signet.css` too — which left the two
 * configs holding a large identical key set in two homes, and #2371 collapsed
 * it into one.
 *
 * What stays here is the surface-specific remainder, and there is exactly one
 * family of it: `gold` is an `apps/web` treatment (the Ask pill), so promoting
 * it would claim a treatment the landing does not implement. The landing's
 * mirror of this file keeps its three marketing type roles for the same shape
 * of reason (foundations §7's amendment). `mention` is NOT in that category —
 * it was web-only until #2367 gave the rebuilt landing a chat frame with an
 * unread DM badge and an in-bubble mention chip, and it moved up with the rest
 * of the common subset.
 *
 * Static values come from `packages/theme/src/signet.css`; the accent family is
 * overridden per chapter by the accent engine at runtime.
 * `packages/theme/src/signet.css.spec.ts` asserts every token read here — and
 * every token the preset reads — is defined there.
 *
 * `darkMode` stays on the class strategy with nothing ever setting the class:
 * Signet is dark-only (the single `:root` block IS the dark theme), so legacy
 * `dark:` variants must stay inert — the Tailwind default `media` strategy
 * would re-activate them for dark-scheme users. Each screen-family slice of
 * #920 deletes its `dark:` variants as it lands.
 *
 * `pointer-coarse` used to be registered here as a **custom variant**, because
 * v3.4 shipped none and every `pointer-coarse:` class in the tree therefore
 * compiled to nothing at all — the chat slice's `CHIP_HIT_AREA`
 * (`components/chat/chip.ts`) grew reaction chips to the §2 44px touch floor
 * only in the source, and the shipped stylesheet contained zero occurrences of
 * `pointer: coarse`. Unknown variants are dropped silently rather than
 * erroring, which is why it read as working for two slices; it was caught by
 * compiling the sheet and grepping it, not by inspection.
 *
 * v4 ships `pointer-coarse` (and `pointer-fine`, and the `any-pointer-*`
 * family) as stock variants emitting the same `@media (pointer: coarse)`, so
 * the plugin is gone rather than kept as a shadow of a built-in. Checked the
 * way the original defect had to be: the compiled `apps/web` stylesheet is
 * byte-identical either side of the removal.
 *
 * That silent-drop failure mode is the reason this file is worth compiling
 * against rather than reading. It is also what the v4 bump hit next, one layer
 * down — see `colorVar` in the shared preset.
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
        gold: {
          house: colorVar("--gold-house"),
          "on-house": colorVar("--gold-on-house"),
          "ask-fill": colorVar("--gold-ask-fill"),
          "ask-border": colorVar("--gold-ask-border"),
          "ask-text": colorVar("--gold-ask-text"),
        },
      },
    },
  },
};

export default config;
