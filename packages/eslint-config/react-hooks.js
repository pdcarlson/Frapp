import pluginReactHooks from "eslint-plugin-react-hooks";

/**
 * Rules taken from v7 `recommended` at upstream severity.
 *
 * New compiler rules that appear in a later plugin bump stay `"off"`
 * until they are added here — a bump must not re-open `--max-warnings 0`.
 *
 * Still held off (findings remain on web/mobile): `set-state-in-effect`,
 * `refs`, `purity`, `preserve-manual-memoization`, `static-components`,
 * `use-memo`. Details: `docs/internal/ci-cd/AGENT_INFRA.md`.
 */
const ENABLED_REACT_HOOKS_RULES = new Set([
  "react-hooks/rules-of-hooks",
  "react-hooks/exhaustive-deps",
  // Compiler rules with 0 findings on web, mobile, landing, and packages/hooks.
  "react-hooks/config",
  "react-hooks/error-boundaries",
  "react-hooks/gating",
  "react-hooks/globals",
  "react-hooks/immutability",
  "react-hooks/incompatible-library",
  "react-hooks/set-state-in-render",
  "react-hooks/unsupported-syntax",
]);

const recommended = pluginReactHooks.configs.flat.recommended;

/**
 * Shared React Hooks block for the Next.js and react-internal presets.
 *
 * @type {import("eslint").Linter.Config}
 */
export const reactHooksConfig = {
  plugins: recommended.plugins,
  rules: Object.fromEntries(
    Object.entries(recommended.rules).map(([name, config]) =>
      ENABLED_REACT_HOOKS_RULES.has(name) ? [name, config] : [name, "off"],
    ),
  ),
};
