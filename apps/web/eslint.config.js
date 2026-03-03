import { nextJsConfig } from "@repo/eslint-config/next-js";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...nextJsConfig,
  {
    files: ["components/ui/**/*.tsx"],
    rules: {
      "react/prop-types": "off",
      "react/no-unknown-property": "off",
    },
  },
];
