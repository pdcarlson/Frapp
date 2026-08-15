import { config as baseConfig } from "@repo/eslint-config/base";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...baseConfig,
  {
    // Belt-and-braces alongside the tsconfig `lib` override: this package must
    // stay callable from NestJS, and a DOM global here is a runtime crash there
    // rather than a compile error. `lint` is a required CI check.
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
