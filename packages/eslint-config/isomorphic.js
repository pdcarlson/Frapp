import { config as baseConfig } from "./base.js";

/**
 * The base config for packages that must never touch a DOM global because
 * the NestJS API or React Native loads them.
 *
 * `@repo/typescript-config/base.json` puts DOM in `lib`, so a `window` or
 * `document` reference in a shared package compiles clean and only fails at
 * runtime, on the API or on device, which is the worst place to find out.
 * Some packages also drop DOM from their own tsconfig; this rule still earns
 * its place there, because specs and config files sit outside that tsconfig
 * and a type-level guard alone is easy to undo. `lint` is a required CI check.
 * The shared `onlyWarn` plugin reports a hit as a warning; every adopting
 * workspace lints with `--max-warnings 0`, so it still fails.
 *
 * The rule sees bare references only: `globalThis.document` is a property
 * access it does not flag. Dropping DOM from a package's tsconfig `lib` is the
 * guard for that inside the compiled sources.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const isomorphicConfig = [
  ...baseConfig,
  {
    rules: {
      "no-restricted-globals": [
        "error",
        "window",
        "document",
        "navigator",
        "location",
        "localStorage",
        "sessionStorage",
      ],
    },
  },
];
