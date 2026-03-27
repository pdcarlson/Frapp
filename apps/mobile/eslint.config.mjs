import { config as reactInternalConfig } from "@repo/eslint-config/react-internal";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...reactInternalConfig,
  {
    files: ["*.js", "jest.config.js", "jest-setup.js", "jest-setup-pre.js", "__mocks__/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "no-undef": "off",
    },
  },
  {
    files: ["**/*.test.tsx", "**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-explicit-any": "off"
    }
  }
];
