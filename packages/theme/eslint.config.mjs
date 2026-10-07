// `apps/mobile` imports `signet.ts` (and through it `tokens.ts`), and React
// Native has no DOM. `getSignetCssVars()` returns custom properties as a plain
// object for that reason; the preset is what keeps a future edit from quietly
// reaching for `document.documentElement`.
export { isomorphicConfig as default } from "@repo/eslint-config/isomorphic";
