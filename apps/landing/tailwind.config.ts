import type { Config } from "tailwindcss";
import sharedConfig from "@repo/theme/tailwind";

/*
 * The landing surface on the Signet scale, since the #2366 token cutover.
 *
 * Shape mirrors `apps/web/tailwind.config.ts` deliberately, and since #2371
 * that means it is nearly empty: the Signet keys both surfaces bind now live
 * once, in the shared preset (`packages/theme/src/tailwind.config.ts`). They
 * used to sit app-local because the preset binds nothing its stylesheet does
 * not define and a preset key reading an undefined token is #1145's silent
 * no-color failure — a real constraint while this surface was frozen on the
 * legacy stylesheet, and a dead one since it shipped `signet.css`.
 *
 * What stays here is what `apps/web` does NOT bind: the three marketing type
 * roles below. They sit deliberately ABOVE `foundations.md` §7's locked six
 * (see that file's amendment, and `README.md` §3 rule 4), so promoting them
 * would put a 72px marketing headline one import away from every product
 * screen — the defect #2371 exists to avoid, reached from the other side.
 * `signet.spec.ts` guards the amendment. The mirror-image remainder in
 * `apps/web` is its `gold` family.
 *
 * `darkMode` stays on the class strategy with nothing setting the class, for
 * the same reason `apps/web` does: Signet is dark-only — the single `:root` IS
 * the dark theme — so any legacy `dark:` variant must stay inert rather than
 * re-activating under the Tailwind default `media` strategy. This PR deleted
 * the landing's `dark:` variants; the strategy stays pinned so a reintroduced
 * one cannot quietly paint.
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
      /*
       * The three marketing roles this surface adds ABOVE §7's locked six.
       * The six themselves come from the shared preset (#2371); these do not
       * join them there, by decision.
       *
       * Unlike the locked six, the marketing three state their own line height
       * and tracking as tokens, declared in `app/globals.css`. §7 states a line
       * height only for `body`, which is why the preset's five siblings carry
       * literals instead (tracked as L-09 in
       * `spec/ui/web-greenfield/tokens.md`; do not settle it by editing one
       * literal in place).
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
      },
    },
  },
};

export default config;
