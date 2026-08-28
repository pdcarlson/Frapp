import { config as baseConfig } from "@repo/eslint-config/base";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...baseConfig,
  {
    // `apps/mobile` consumes `tokens.ts` and `signet.ts` directly, and React
    // Native has no DOM. The shared tsconfig puts DOM in `lib`, so a `document`
    // or `window` reference here compiles clean and only explodes on device —
    // the same trap `@repo/color` and `@repo/chapter-theme` guard against, and
    // the reason those two carry this rule. `lint` is a required CI check.
    //
    // `getSignetCssVars()` returns custom properties as a plain object rather
    // than touching the DOM precisely so this stays true; the rule is what keeps
    // a future edit from quietly reaching for `document.documentElement`.
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        "window",
        "document",
        "navigator",
        "localStorage",
      ],
    },
  },
];
