import { config as baseConfig } from "@repo/eslint-config/base";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...baseConfig,
  {
    // Same belt-and-braces as `@repo/color`: this package is consumed by
    // React Native, so a DOM global here is a runtime crash there rather
    // than a compile error.
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
