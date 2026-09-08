import { nextJsConfig } from "@repo/eslint-config/next-js";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...nextJsConfig,
  {
    files: ["*.config.js", "*.config.mjs", "*.config.ts"],
    languageOptions: {
      globals: { process: "readonly" },
    },
  },
  {
    files: ["lib/assert-production-app-env.js"],
    languageOptions: {
      globals: { process: "readonly" },
    },
  },
];
