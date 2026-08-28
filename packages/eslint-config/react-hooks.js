import pluginReactHooks from "eslint-plugin-react-hooks";

/**
 * Every rule v7 ships, at upstream severity — no rule is held off.
 *
 * This allowlist is the gate, not the config it is derived from: a rule the
 * plugin ships but that is missing from this set is forced `"off"`, so a later
 * plugin bump cannot re-open `--max-warnings 0`. Adopting a new compiler rule
 * stays a dedicated cleanup (fix or scope-disable each finding, then add the
 * name here).
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
  "react-hooks/void-use-memo",
]);

// `recommended-latest` rather than `recommended`: as of 7.1.1 it is a strict
// superset — same 16 rules at identical severities, plus `void-use-memo`
// (#1134). Sourcing the superset keeps every rule the plugin ships explicitly
// accounted for as either allowlisted-at-upstream-severity or `"off"`.
const recommended = pluginReactHooks.configs.flat["recommended-latest"];

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
