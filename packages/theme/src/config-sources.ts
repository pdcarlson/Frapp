import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/*
 * The two app configs, as source text.
 *
 * **Read rather than imported, deliberately.** Each app is its own TypeScript
 * project; importing its config from this package would couple the two builds'
 * typechecks, and a plain module import does not resolve `presets` anyway, so
 * it would see only the app's own remainder.
 *
 * Shared by `signet.css.spec.ts` and `tailwind.config.spec.ts`, which both need
 * these paths and both need the comment-stripping below. They had a copy each.
 */
export const WEB_TAILWIND = fileURLToPath(
  new URL("../../../apps/web/tailwind.config.ts", import.meta.url),
);
export const LANDING_TAILWIND = fileURLToPath(
  new URL("../../../apps/landing/tailwind.config.ts", import.meta.url),
);

/**
 * A config's source with comments removed.
 *
 * Every assertion here matches raw text, and since #2371 took their keys both
 * configs are mostly prose — each one discusses the other's remainder by name.
 * Without this, a sentence quoting `colorVar("--surface-1")` counts as a
 * binding, and a header rewrite fails a scan about keys nobody moved. The
 * counts are exact rather than floors precisely because the code is now a small
 * closed set, so they have to measure the code.
 */
export const readConfigCode = (source: string): string =>
  readFileSync(source, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
