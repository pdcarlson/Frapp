/**
 * dependency-cruiser — architectural boundary linting.
 *
 * Rules encode boundaries this codebase already states in prose but nothing
 * enforced: the API's layer direction (`.claude/skills/api-development/SKILL.md`,
 * and "Architecture pattern" in `spec/architecture/README.md`), and the
 * monorepo's app/package separation.
 *
 * ## Why this config is workspace-aware
 *
 * `apps/web` and `apps/mobile` each map `@/*` to their OWN root, so no single
 * alias table can resolve both. The only correct resolution is one depcruise
 * run per workspace with that workspace as cwd — which is what
 * `scripts/check-dep-cruiser.mjs` does. Getting this wrong is not subtle but it
 * is silent: cruising from the repo root reported **792 unresolvable-module
 * violations** that were purely the aliases failing to resolve, and `apps/web`
 * cruises completely clean once its own tsconfig is used.
 *
 * The consequence is that every path here is relative to the workspace, not the
 * repo root, and rules that only make sense for one workspace are selected by
 * `DEPCRUISE_WORKSPACE` rather than written as a root-anchored path that would
 * silently match nothing.
 *
 * ## Rollout
 *
 * Hard gate from day one, made survivable by a committed baseline:
 * `.dependency-cruiser-known-violations.json` grandfathers every violation that
 * existed when the gate landed, and any NEW violation fails.
 * See `docs/internal/ci-cd/QUALITY_GATES.md`.
 *
 * Run: `npm run check:dep-cruiser`
 */

/** Set by scripts/check-dep-cruiser.mjs, e.g. "apps/api". */
const WORKSPACE = process.env.DEPCRUISE_WORKSPACE ?? "";
const isApi = WORKSPACE === "apps/api";
const isPackage = WORKSPACE.startsWith("packages/");
const isApp = WORKSPACE.startsWith("apps/");

/**
 * Build output, vendored code, and generated artifacts — never source.
 * Anchor-agnostic, since paths are workspace-relative (see above).
 */
const NOT_SOURCE = [
  "node_modules",
  "(^|/)dist/",
  "(^|/)build/",
  "(^|/)\\.next/",
  "(^|/)\\.expo/",
  "(^|/)coverage/",
  "(^|/)\\.turbo/",
  "(^|/)test-results/",
  "(^|/)playwright-report/",
  // The Buildpad planning canvas: research notes and markdown, synced
  // periodically. It holds no code, so cruising it could only ever produce
  // noise — and a canvas sync must never fail a required gate.
  "(^|/)\\.buildpad(/|$)",
  // Generated from the OpenAPI contract by openapi-typescript; its shape is the
  // generator's business, not something a boundary rule should have an opinion on.
  "(^|/)api-sdk/src/types\\.ts$",
].join("|");

/** Tests and config may reach for devDependencies and across layers. */
const NOT_SHIPPED_CODE =
  "\\.(spec|test|e2e-spec)\\.(ts|tsx|js|jsx|mjs)$" +
  "|(^|/)(tests?|__tests__|__mocks__|e2e)/" +
  "|\\.config\\.(ts|js|mjs|cjs)$";

/**
 * apps/api layer direction: Interface → Application → Infrastructure → Domain.
 * Outer may import inner; never the reverse. One rule per illegal edge, so a
 * failure names the boundary that broke rather than "a layering rule".
 */
const apiLayerRules = [
  {
    name: "api-domain-is-innermost",
    severity: "error",
    comment:
      "domain/ holds entities, repository interfaces and business rules. It must not know " +
      "about controllers, services, or Supabase — that inversion is what makes the domain " +
      "testable and the persistence layer swappable.",
    from: { path: "^src/domain/" },
    to: { path: "^src/(interface|application|infrastructure)/" },
  },
  {
    name: "api-infrastructure-not-to-outer",
    severity: "error",
    comment:
      "infrastructure/ implements the domain's interfaces. Reaching back up into " +
      "application/ or interface/ turns an adapter into a second home for business logic.",
    from: { path: "^src/infrastructure/" },
    to: { path: "^src/(interface|application)/" },
  },
  {
    name: "api-application-not-to-interface",
    severity: "error",
    comment:
      "application/ is the business logic. Importing from interface/ couples it to HTTP " +
      "concerns (DTOs, guards, decorators) and makes it unusable from any other entry point.",
    from: { path: "^src/application/" },
    to: { path: "^src/interface/" },
  },
];

/**
 * Sibling app directory names, passed in by the runner (e.g. "api,landing,mobile"
 * when cruising apps/web).
 *
 * Enumerated rather than pattern-matched, and that is a correction rather than a
 * preference. The obvious spelling — "one level up, then any directory",
 * `^\.\./[^/]+/` — is wrong in a way that looks right: `[^/]+` happily matches
 * `..`, so `../../packages/hooks/x` (every shared-package import an app makes)
 * matched, and the rule reported 60+ intra-package imports as cross-app ones.
 */
const SIBLING_APPS = (process.env.DEPCRUISE_SIBLING_APPS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Cross-workspace boundaries. Expressed against `../` because a workspace that
 * imports another one resolves outside its own cwd.
 */
const boundaryRules = [
  ...(isPackage
    ? [
        {
          name: "packages-not-to-apps",
          severity: "error",
          comment:
            "A shared package importing an app inverts the dependency graph: the package can " +
            "no longer be built or published without the app, and every other consumer " +
            "inherits that.",
          from: {},
          // packages/<x> → apps/<y> is always exactly two levels up.
          to: { path: "^\\.\\./\\.\\./apps/[^/]+/" },
        },
      ]
    : []),
  ...(isApp && SIBLING_APPS.length > 0
    ? [
        {
          name: "no-cross-app-imports",
          severity: "error",
          comment:
            "Apps share code through packages/, never directly. A direct reach across breaks " +
            "independent builds and deploys — apps/web and apps/api ship to different platforms.",
          from: {},
          to: { path: `^\\.\\./(${SIBLING_APPS.join("|")})/` },
        },
      ]
    : []),
];

module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment:
        "A cycle makes module init order load-bearing and undefined, and it defeats any " +
        "attempt to reason about a module in isolation.",
      from: {},
      to: { circular: true },
    },
    ...(isApi ? apiLayerRules : []),
    ...boundaryRules,
    {
      name: "not-to-dev-dep",
      severity: "error",
      comment:
        "Shipped code must not import a devDependency: it is absent from the production " +
        "install and fails at runtime, not at build time.",
      from: { pathNot: NOT_SHIPPED_CODE },
      to: { dependencyTypes: ["npm-dev"], dependencyTypesNot: ["type-only"] },
    },
    {
      name: "no-deprecated-core",
      severity: "error",
      comment: "Deprecated Node core modules are removed in later runtimes.",
      from: {},
      to: { dependencyTypes: ["core"], path: "^(punycode|domain|sys)$" },
    },
  ],

  options: {
    doNotFollow: { path: NOT_SOURCE },
    exclude: { path: NOT_SOURCE },

    // Resolve TypeScript before it is compiled, so the graph reflects source
    // rather than whatever happens to be sitting in dist/.
    tsPreCompilationDeps: true,

    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".d.ts"],
      mainFields: ["module", "main", "types", "typings"],
    },

    cache: false,
  },
};
