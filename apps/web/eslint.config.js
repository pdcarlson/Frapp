import { nextJsConfig } from "@repo/eslint-config/next-js";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...nextJsConfig,
  {
    // Build-time config files run in Node, not the browser, so `process` is a
    // real global here. The shared Next preset targets app code, where it is not.
    files: ["*.config.js", "*.config.mjs", "*.config.ts"],
    languageOptions: {
      globals: { process: "readonly" },
    },
  },
  {
    files: ["components/ui/**/*.tsx"],
    rules: {
      "react/prop-types": "off",
      "react/no-unknown-property": "off",
    },
  },
];
