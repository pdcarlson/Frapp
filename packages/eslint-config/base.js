import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import turboPlugin from "eslint-plugin-turbo";
import tseslint from "typescript-eslint";
import onlyWarn from "eslint-plugin-only-warn";

/**
 * A shared ESLint configuration for the repository.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const config = [
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  {
    plugins: {
      turbo: turboPlugin,
    },
    rules: {
      "turbo/no-undeclared-env-vars": "warn",
    },
  },
  {
    plugins: {
      onlyWarn,
    },
  },
  {
    // `coverage/**` is generated, and leaving it lintable makes running the
    // tests break the lint gate. Istanbul's HTML report assets carry an
    // `/* eslint-disable */` header; under the react-internal preset
    // `globals.browser` means `no-undef` never fires on `document`, so the
    // directive suppresses nothing and ESLint reports it as unused — a warning,
    // which `--max-warnings 0` turns into a failure. Running `npm run test:cov`
    // in a workspace would then fail `npm run lint` there forever, pointing at a
    // gitignored file that `git status` does not show.
    ignores: ["dist/**", "coverage/**"],
  },
];
