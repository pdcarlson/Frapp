import { config as baseConfig } from "@repo/eslint-config/base";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...baseConfig,
  {
    // Upstream source held under `--max-warnings 0` would fail on style alone,
    // and reformatting it would destroy the byte-for-byte diff that makes the
    // provenance checkable. It is still typechecked and still built.
    ignores: ["src/vendor/**"],
  },
  {
    // This package runs inside the NestJS API. A DOM global here compiles clean
    // (the shared tsconfig puts DOM in `lib`) and only fails at runtime, which
    // is the worst place to find out. `lint` is a required CI check.
    files: ["src/**/*.ts"],
    ignores: ["src/vendor/**"],
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
