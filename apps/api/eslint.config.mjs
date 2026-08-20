// @ts-check
import nestjsTyped from '@darraghor/eslint-plugin-nestjs-typed';
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-base-to-string': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
  // Response-schema rule: every controller method must declare the response type
  // it returns. This is what makes the generated SDK usable — a route with no
  // declared response generates `content?: never`, so callers get no types for
  // the body and the contract silently says "returns nothing".
  //
  // ROLLOUT: deliberately "warn", not "error", and it must stay that way until
  // the route-DTO backfill lands. The rule fires once per undecorated controller
  // method and there are **142** of them today (measured, not estimated — the
  // planning docs guessed ~30, which is out by ~5x and is exactly the number
  // someone would use to decide the backlog was finished). ESLint has no native
  // baseline mechanism the way dependency-cruiser does, so "error" today would
  // simply turn `lint`, a required check, red on every PR until every one of
  // those routes is done. Warn now, backfill, then flip to "error" and delete
  // this paragraph.
  //
  // Only the plugin's `nestjs-typed/api-method-should-specify-api-response` rule
  // is enabled. The bundled `flatRecommended` preset turns on 20+ rules at once,
  // which is a different and much larger decision.
  //
  // `.buildpad/` needs no exclusion here: the lint script globs
  // `{src,apps,libs,test}/**/*.ts` relative to apps/api and there is no
  // repo-root ESLint config, so the canvas is unreachable from any lint run.
  {
    files: ['src/**/*.controller.ts'],
    plugins: { 'nestjs-typed': nestjsTyped.plugin },
    rules: {
      'nestjs-typed/api-method-should-specify-api-response': 'warn',
    },
  },
  {
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
      '@typescript-eslint/require-await': 'off',
      'no-empty': 'off',
    },
  },
);
