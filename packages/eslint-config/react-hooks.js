import pluginReactHooks from "eslint-plugin-react-hooks";

/**
 * Core Rules of Hooks. v7 `recommended` also enables React Compiler
 * rules (`set-state-in-effect`, `refs`, …); we do not run the compiler,
 * and those rules currently fail `--max-warnings 0` on `apps/web` and
 * `apps/mobile`. Keep the two core rules at upstream severity and hold
 * the rest at `"off"` so a later plugin bump cannot re-open the lint
 * gate. Details: `docs/internal/ci-cd/AGENT_INFRA.md`.
 */
const CORE_REACT_HOOKS_RULES = new Set([
  "react-hooks/rules-of-hooks",
  "react-hooks/exhaustive-deps",
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
      CORE_REACT_HOOKS_RULES.has(name) ? [name, config] : [name, "off"],
    ),
  ),
};
