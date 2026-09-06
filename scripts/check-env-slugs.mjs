#!/usr/bin/env node

// Infisical environment-slug gate: every place this repo names an Infisical environment
// must name one that actually exists.
//
// The failure this exists to catch is not hypothetical. Infisical's environments carry a
// display *name* and a separate *slug*, and two of our three differ — "Development" is
// `dev` and "Production" is `prod`. The docs asserted a `local` environment and a
// `production` slug, neither of which exists, and `package.json` followed the docs: all
// five `npm run dev:*` scripts passed `--env=local` and could never resolve an
// environment. It survived a long time because the only automation that talks to Infisical
// (the deploy/migrate workflows) hardcodes `staging`/`prod` correctly, and the cloud
// sandbox writes `apps/*/.env.local` directly — so nothing in CI ever exercised the
// `--env=` path that was broken.
//
// Source of truth: Infisical → Project Settings → Environments, which lists Name and Slug
// side by side. That page is the only authority; this file mirrors it, and everything else
// in the repo is checked against this file.
//
// Scope note: this gate proves *internal consistency* — that nothing references a slug we
// do not believe in. It cannot notice someone renaming an environment in the Infisical
// dashboard. If that happens, the deploy workflows fail loudly on the next run and this
// list is the one place to update.
//
// See docs/internal/environment/ENV_REFERENCE.md § Infisical Environments.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The real slugs, mirrored from Infisical → Project Settings → Environments.
 * Update here — and only here — if an environment is ever added or renamed.
 */
export const INFISICAL_ENV_SLUGS = ["dev", "staging", "prod"];

/** UI display names, kept only so failure output can explain the name/slug trap. */
const UI_NAMES = { dev: "Development", staging: "Staging", prod: "Production" };

const CANONICAL_DOC = "docs/internal/environment/ENV_REFERENCE.md";

/**
 * Environment identity, which names an Infisical slug per environment. Scanned
 * for the same reason everything else here is: it is a hand-written copy of a
 * fact that lives in the Infisical dashboard, and an unscanned copy is how
 * `local` reached six docs and package.json in the first place.
 */
const ENVIRONMENTS_CONFIG = ".github/environments.json";

/** Everything the scan reads. Checked for existence first — see section 0. */
const SCAN_ROOTS = [
  "package.json",
  ".infisical.json",
  ENVIRONMENTS_CONFIG,
  ".github/workflows",
  // Composite actions are the other place a step can carry an `env-slug:`. The
  // Infisical injection is a named candidate for extraction into one (#1382),
  // and a slug that moved into an unscanned file would make this gate pass
  // vacuously over it -- the failure this file's section 0 exists to refuse.
  ".github/actions",
  "docs",
  "spec",
  CANONICAL_DOC,
];

export function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

/** Recursively collect files under `dir` matching `test`. */
function walk(dir, test, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, test, out);
    else if (test(full)) out.push(full);
  }
  return out;
}

function read(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * Every match of `re` (capture group 1 = slug) in `text` whose slug is not in `known`.
 * Pure so the gate itself is testable — an unexercised gate is indistinguishable from a
 * healthy one right up until it silently stops asserting anything.
 */
export function unknownSlugsIn(text, re, known = INFISICAL_ENV_SLUGS) {
  const out = [];
  for (const m of text.matchAll(re)) {
    if (!known.includes(m[1])) out.push({ line: lineOf(text, m.index), found: m[1] });
  }
  return out;
}

/** Every environment slug `.infisical.json` claims, as `[key, slug]` pairs. */
export function infisicalConfigSlugs(cfg) {
  return [
    ["defaultEnvironment", cfg?.defaultEnvironment],
    ...Object.entries(cfg?.gitBranchToEnvironmentMapping ?? {}).map(
      ([branch, env]) => [`gitBranchToEnvironmentMapping.${branch}`, env],
    ),
  ].filter(([, slug]) => slug != null);
}

/** The "## Infisical Environments" block of the canonical doc, or null. */
export function canonicalSection(docText) {
  return docText?.split("## Infisical Environments")[1]?.split("\n---")[0] ?? null;
}

const IS_ENTRYPOINT =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

function main() {
  const violations = [];
  const report = (file, line, found, context) =>
    violations.push({ file, line, found, context });
  const scan = (file, text, re, context) => {
    for (const v of unknownSlugsIn(text, re)) report(file, v.line, v.found, context);
  };

  // ── 0. Every root we intend to scan must still be there ────────────────────────
  // Without this, a rename makes the gate green while asserting nothing: `walk()` returns
  // [] for a missing directory and `read()` returns null for a missing file, so the scan
  // silently covers zero bytes. A gate that passes vacuously is worse than no gate — it
  // is the exact shape of the bug this file exists to prevent.
  for (const root of SCAN_ROOTS) {
    if (!existsSync(root)) {
      report(root, 1, "(missing)", "path this gate must scan no longer exists");
    }
  }

  // ── 1. package.json — `infisical run --env=<slug>` in the dev:* scripts ──────────
  const pkg = read("package.json");
  if (pkg) {
    scan(
      "package.json",
      pkg,
      /infisical run --env=([A-Za-z0-9_-]+)/g,
      "infisical run --env=",
    );
  }

  // ── 2. .infisical.json — defaultEnvironment and the branch mapping ──────────────
  const infisicalRaw = read(".infisical.json");
  if (infisicalRaw) {
    let cfg = null;
    try {
      cfg = JSON.parse(infisicalRaw);
    } catch {
      report(".infisical.json", 1, "(unparseable)", "invalid JSON");
    }
    for (const [key, slug] of cfg ? infisicalConfigSlugs(cfg) : []) {
      if (!INFISICAL_ENV_SLUGS.includes(slug)) {
        const idx = infisicalRaw.indexOf(`"${slug}"`);
        report(
          ".infisical.json",
          idx === -1 ? 1 : lineOf(infisicalRaw, idx),
          slug,
          key,
        );
      }
    }
  }

  // ── 3. Workflows and composite actions — `env-slug:` passed to Infisical/secrets-action ──
  const actionYaml = (f) => /\.ya?ml$/.test(f);
  for (const wf of [
    ...walk(".github/workflows", actionYaml),
    ...walk(".github/actions", actionYaml),
  ]) {
    const text = read(wf);
    if (text) scan(wf, text, /env-slug:\s*["\']([A-Za-z0-9_-]+)["\']/g, "env-slug:");
  }

  // ── 4. Docs and spec — any `--env=<slug>` a reader would copy/paste ─────────────
  // Deliberately broad: it matches `--env=` regardless of the surrounding command, because
  // breadth is cheap to explain and hard to defeat by accident — a narrower pattern keyed to
  // the command name is defeated by any rephrasing of the example. Infisical is currently the
  // only tool we document with this flag (eas takes --profile, vercel --environment), so
  // there is nothing else to hit. If a second `--env=` tool ever shows up in docs, scope
  // this match to lines mentioning infisical rather than widening INFISICAL_ENV_SLUGS —
  // widening disarms the gate.
  for (const doc of [
    ...walk("docs", (f) => f.endsWith(".md")),
    ...walk("spec", (f) => f.endsWith(".md")),
  ]) {
    const text = read(doc);
    if (text) scan(doc, text, /--env=([A-Za-z0-9_-]+)/g, "--env= in a doc example");
  }

  // ── 4b. .github/environments.json — the `infisicalEnvSlug` of each environment ───────
  // The trap this catches is specifically the name/slug one: the environment is
  // *named* "production" in this file's own keys, and its Infisical slug is `prod`.
  // Writing `"infisicalEnvSlug": "production"` next to `"production": {` reads
  // perfectly and resolves to nothing.
  const envConfig = read(ENVIRONMENTS_CONFIG);
  if (envConfig) {
    scan(
      ENVIRONMENTS_CONFIG,
      envConfig,
      /"infisicalEnvSlug":\s*"([A-Za-z0-9_-]+)"/g,
      "infisicalEnvSlug",
    );
  }

  // ── 5. The canonical table must list exactly the real slugs ─────────────────────
  // ENV_REFERENCE.md is where a human looks up "which environment am I touching". If it
  // omits one or invents one, every doc downstream inherits the error — which is exactly
  // how `local` propagated into six docs and package.json.
  const canonical = read(CANONICAL_DOC);
  const section = canonicalSection(canonical);
  if (canonical === null) {
    report(CANONICAL_DOC, 1, "(missing)", "canonical environment table not found");
  } else if (!section) {
    report(CANONICAL_DOC, 1, "(missing)", "no '## Infisical Environments' section");
  } else {
    const at = lineOf(canonical, canonical.indexOf("## Infisical Environments"));
    for (const slug of INFISICAL_ENV_SLUGS) {
      if (!new RegExp("`" + slug + "`").test(section)) {
        report(
          CANONICAL_DOC,
          at,
          slug,
          `slug missing from the environment table (expected \`${slug}\` for "${UI_NAMES[slug] ?? slug}")`,
        );
      }
    }
  }

  return violations;
}

// Only scan (and exit) when run as a CLI. Importing the module — which the test does —
// must have no side effects at all.
if (IS_ENTRYPOINT) {
  const violations = main();

  if (violations.length === 0) {
    console.log(
      `✓ env slugs consistent — every reference uses one of: ${INFISICAL_ENV_SLUGS.join(", ")}`,
    );
    process.exit(0);
  }

  console.error("\n✗ Unknown Infisical environment slug(s).\n");
  console.error(
    "  Real environments (Infisical → Project Settings → Environments):\n" +
      INFISICAL_ENV_SLUGS.map((s) => `    ${(UI_NAMES[s] ?? "?").padEnd(12)} → ${s}`).join("\n") +
      "\n",
  );
  console.error(
    "  Note the trap: the UI shows Development/Production, but the slugs are dev/prod.\n" +
      "  Tools take the SLUG. A wrong one does not warn — it fails to resolve.\n",
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.context} → "${v.found}"`);
  }
  console.error(
    "\n  Fix the reference, or if an environment really was renamed, update " +
      `INFISICAL_ENV_SLUGS in scripts/check-env-slugs.mjs and ${CANONICAL_DOC}.\n`,
  );
  process.exit(1);
}
