import pluginReactHooks from "eslint-plugin-react-hooks";

/**
 * Rules taken from v7 `recommended` at upstream severity.
 *
 * New compiler rules that appear in a later plugin bump stay `"off"`
 * until they are added here — a bump must not re-open `--max-warnings 0`.
 *
 * `recommended-latest` extras (e.g. `void-use-memo`) are not in `recommended`
 * and stay off until a dedicated cleanup.
 */
const ENABLED_REACT_HOOKS_RULES = new Set([
  "react-hooks/rules-of-hooks",
  "react-hooks/exhaustive-deps",
  "react-hooks/config",
  "react-hooks/error-boundaries",
  "react-hooks/gating",
  "react-hooks/globals",
  "react-hooks/immutability",
  "react-hooks/incompatible-library",
  "react-hooks/preserve-manual-memoization",
  "react-hooks/purity",
  "react-hooks/refs",
  "react-hooks/set-state-in-effect",
  "react-hooks/set-state-in-render",
  "react-hooks/static-components",
  "react-hooks/unsupported-syntax",
  "react-hooks/use-memo",
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
