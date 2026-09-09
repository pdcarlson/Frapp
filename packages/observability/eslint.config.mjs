import { config as baseConfig } from "@repo/eslint-config/base";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...baseConfig,
  {
    // This package is imported by web, landing, React Native, and NestJS.
    // A DOM or browser global here is a runtime crash on the API, not a
    // compile error — the tsconfig already drops DOM from `lib`.
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
