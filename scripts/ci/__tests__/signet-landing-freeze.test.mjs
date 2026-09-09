// Locks the landing freeze on Frapp until the USPTO unfreeze.
//
// WHY THIS EXISTS. Live frapp.live still serves Frapp marketing titles
// on purpose. A leftover sweep can flip those titles to Signet before
// the USPTO search clears, switch a title to single quotes the first
// lock used to miss, or add a third metadata site the hardcoded paths
// would miss. This lock is the freeze, not the unfreeze. The unfreeze
// issue (1954) replaces this file with a Signet-title lock. USPTO stay
// on 1901. Leave store-name on 1829.
//
// SCOPE. Landing metadata titles, JSON-LD SoftwareApplication / brand
// names, the lockup aria-label, and the spec freeze banner. Do not
// restyle icons or tokens. Do not change landing product copy here.
// Do not walk apps/web (those titles are already Signet).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const LOCK = fileURLToPath(import.meta.url);
const LANDING_APP = join(REPO_ROOT, "apps/landing/app");

const LAYOUT = "apps/landing/app/layout.tsx";
const SUPPORT = "apps/landing/app/support/page.tsx";
const HOME = "apps/landing/app/page.tsx";
const LOCKUP = "apps/landing/components/frapp-lockup.tsx";
const SPEC = "spec/ui/landing/README.md";

const HOME_TITLE = "Frapp — The Operating System for Greek Life";
const SUPPORT_TITLE = "Support — Frapp";

/** Root + OG + Twitter + /support. Deleting a title must fail, not pass. */
const MIN_METADATA_TITLES = 4;

const SKIP_DIRS = new Set(["node_modules", "dist", ".next", "coverage"]);

function readRepo(rel) {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

function walkTsx(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...walkTsx(path));
      continue;
    }
    if (!entry.isFile() || !/\.tsx$/.test(entry.name)) continue;
    out.push(path);
  }
  return out;
}

export function isMetadataFile(source) {
  return /export const metadata/.test(source);
}

export function collectMetadataTitles(source) {
  if (!isMetadataFile(source)) return [];
  const titles = [];
  const pattern = /title:\s*(["'])([^"']+)\1/g;
  for (const match of source.matchAll(pattern)) {
    titles.push(match[2]);
  }
  return titles;
}

export function jsonLdNames(source) {
  return [...source.matchAll(/name:\s*(["'])([^"']+)\1/g)].map((match) => match[2]);
}

export function metadataTitleProblems(files) {
  const problems = [];
  const found = [];
  for (const { rel, source } of files) {
    for (const title of collectMetadataTitles(source)) {
      found.push({ rel, title });
      if (!/Frapp/.test(title)) problems.push(`${rel}:missing-frapp`);
      if (/Signet/.test(title)) problems.push(`${rel}:signet`);
    }
  }
  if (found.length < MIN_METADATA_TITLES) {
    problems.push("landing must keep the frozen metadata titles");
  }
  return problems;
}

export function frozenTitleProblems({ layout, support }) {
  const problems = [];
  const quoted = HOME_TITLE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const homeHits = [...layout.matchAll(new RegExp(`title: ["']${quoted}["']`, "g"))];
  if (homeHits.length !== 3) {
    problems.push("layout metadata / OG / Twitter titles");
  }
  const supportQuoted = SUPPORT_TITLE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`title: ["']${supportQuoted}["']`).test(support)) {
    problems.push("support metadata title");
  }
  return problems;
}

export function jsonLdProblems(home) {
  const problems = [];
  const names = jsonLdNames(home);
  if (!names.includes("Frapp")) {
    problems.push("SoftwareApplication name");
  }
  if (names.filter((name) => name === "Frapp").length !== 2) {
    problems.push("application + brand");
  }
  if (names.includes("Signet")) {
    problems.push("JSON-LD must not name Signet yet");
  }
  return problems;
}

export function freezeSurfaceProblems({ lockup, spec }) {
  const problems = [];
  if (!/aria-label=["']Frapp["']/.test(lockup)) {
    problems.push("lockup aria-label must stay Frapp");
  }
  if (/aria-label=["']Signet["']/.test(lockup)) {
    problems.push("lockup aria-label must not be Signet");
  }
  if (!/> \*\*FROZEN \(pre-Signet\)\.\*\*/.test(spec)) {
    problems.push("spec must keep the freeze banner");
  }
  return problems;
}

export function lockSelfProblems(source) {
  const problems = [];
  const floor = source.match(/^const MIN_METADATA_TITLES = (\d+);?$/m);
  if (!floor || floor[1] !== "4") {
    problems.push("MIN_METADATA_TITLES must stay 4");
  }
  const landing = source.match(
    /^const LANDING_APP = join\(REPO_ROOT, "([^"]+)"\);?$/m,
  );
  if (!landing || landing[1] !== "apps/landing/app") {
    problems.push("walker must stay on apps/landing/app");
  }
  if (landing && landing[1].startsWith("apps/web")) {
    problems.push("must not walk apps/web");
  }
  if (!/title:\\s\*\(\["'\]/.test(source)) {
    problems.push("must collect single-quoted and double-quoted titles");
  }
  return problems;
}

function liveMetadataFiles() {
  return walkTsx(LANDING_APP).map((path) => ({
    rel: relative(REPO_ROOT, path).replaceAll("\\", "/"),
    source: readFileSync(path, "utf8"),
  }));
}

test("landing metadata titles stay Frapp, not Signet", () => {
  assert.deepEqual(metadataTitleProblems(liveMetadataFiles()), []);
  assert.deepEqual(
    frozenTitleProblems({
      layout: readRepo(LAYOUT),
      support: readRepo(SUPPORT),
    }),
    [],
  );
});

test("JSON-LD application and brand names stay Frapp", () => {
  assert.deepEqual(jsonLdProblems(readRepo(HOME)), []);
});

test("lockup aria-label and spec freeze banner stay Frapp", () => {
  assert.deepEqual(
    freezeSurfaceProblems({
      lockup: readRepo(LOCKUP),
      spec: readRepo(SPEC),
    }),
    [],
  );
});

test("putting Signet in a layout metadata title fails", () => {
  const problems = metadataTitleProblems([
    {
      rel: LAYOUT,
      source: readRepo(LAYOUT).replaceAll(HOME_TITLE, "Signet — The Operating System for Greek Life"),
    },
    { rel: SUPPORT, source: readRepo(SUPPORT) },
  ]);
  assert.ok(
    problems.some((problem) => problem.includes("signet")),
    problems.join("; "),
  );
});

test("dropping a layout OG title fails the floor", () => {
  const problems = metadataTitleProblems([
    {
      rel: LAYOUT,
      source: readRepo(LAYOUT).replace(
        `openGraph: {\n    title: "${HOME_TITLE}",`,
        "openGraph: {\n    description: ogDescription,",
      ),
    },
    { rel: SUPPORT, source: readRepo(SUPPORT) },
  ]);
  assert.ok(
    problems.some((problem) => problem.includes("frozen metadata titles")),
    problems.join("; "),
  );
});

test("a single-quoted Signet title is collected", () => {
  assert.deepEqual(
    collectMetadataTitles(
      `export const metadata = {\n  title: 'Signet — Privacy',\n};\n`,
    ),
    ["Signet — Privacy"],
  );
});

test("a third JS-style Signet metadata site fails the walk", () => {
  const rel = "apps/landing/app/privacy/page.tsx";
  const source = "export const metadata = {\n  title: 'Signet — Privacy',\n};\n";
  assert.equal(isMetadataFile(source), true);
  assert.deepEqual(metadataTitleProblems([{ rel, source }]), [
    `${rel}:missing-frapp`,
    `${rel}:signet`,
    "landing must keep the frozen metadata titles",
  ]);
});

test("putting Signet in JSON-LD fails", () => {
  const problems = jsonLdProblems(
    readRepo(HOME).replace('name: "Frapp"', 'name: "Signet"'),
  );
  assert.ok(
    problems.some((problem) => problem.includes("Signet") || problem.includes("Frapp")),
    problems.join("; "),
  );
});

test("dropping the lockup aria-label fails", () => {
  const problems = freezeSurfaceProblems({
    lockup: readRepo(LOCKUP).replace('aria-label="Frapp"', 'aria-label="Signet"'),
    spec: readRepo(SPEC),
  });
  assert.ok(
    problems.some((problem) => problem.includes("aria-label")),
    problems.join("; "),
  );
});

test("dropping the freeze banner fails", () => {
  const problems = freezeSurfaceProblems({
    lockup: readRepo(LOCKUP),
    spec: readRepo(SPEC).replace(
      "> **FROZEN (pre-Signet).**",
      "> **UNFROZEN (Signet).**",
    ),
  });
  assert.ok(
    problems.some((problem) => problem.includes("freeze banner")),
    problems.join("; "),
  );
});

test("walker stays on landing and keeps the floor", () => {
  assert.deepEqual(lockSelfProblems(readFileSync(LOCK, "utf8")), []);
});

test("pointing the walker at web fails", () => {
  const problems = lockSelfProblems(
    readFileSync(LOCK, "utf8").replace(
      'const LANDING_APP = join(REPO_ROOT, "apps/landing/app")',
      'const LANDING_APP = join(REPO_ROOT, "apps/web/app")',
    ),
  );
  assert.ok(
    problems.some((problem) => problem.includes("apps/web")),
    problems.join("; "),
  );
});

test("dropping MIN_METADATA_TITLES below 4 fails", () => {
  const problems = lockSelfProblems(
    readFileSync(LOCK, "utf8").replace(
      "const MIN_METADATA_TITLES = 4",
      "const MIN_METADATA_TITLES = 3",
    ),
  );
  assert.ok(
    problems.some((problem) => problem.includes("MIN_METADATA_TITLES")),
    problems.join("; "),
  );
});

test("refuses a GitHub closer next to an issue number", () => {
  assert.doesNotMatch(
    readFileSync(LOCK, "utf8"),
    /\b(fixes|closes|close|fix|fixed|resolve|resolves|resolved)\s+#/i,
  );
});
