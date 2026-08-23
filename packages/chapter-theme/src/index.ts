/**
 * @repo/chapter-theme
 *
 * The Signet chapter accent engine: one seed hex in, the `--signet-*` role
 * tokens out. Implementation lives in `./signet.ts`; the flat token type and
 * the semantic re-key live in `./accent-vars.ts`, which is a dependency-free
 * leaf so a browser bundle can import it without pulling the generator in.
 *
 * Specified by `spec/ui/design-system/accent-engine.md`.
 *
 * This barrel is the `.` entrypoint and reaches the vendored Radix generator,
 * so server code imports it and client code imports
 * `@repo/chapter-theme/accent-vars` instead.
 *
 * The legacy `derivePalette` two-colour engine that used to live here was
 * deleted in the #920 slice-9 cutover. Nothing read its output: the web
 * dashboard stopped applying its tokens at the shell slice, and mobile only
 * ever read the `--signet-*` half. `resolveChapterAccentColor`
 * (`@repo/theme/accent`) is a different unit and is still live — it re-validates
 * a stored accent against a real background, and did not depend on this engine.
 */

export {
  deriveSignetPalette,
  signetAccentSemanticVars,
  HOUSE_SEED,
  type DeriveSignetPaletteResult,
  type SignetContrastCheck,
  type SignetPalette,
} from "./signet.js";
