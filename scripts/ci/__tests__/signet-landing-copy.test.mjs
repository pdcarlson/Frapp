// Locks landing customer chrome on Signet.
//
// WHY THIS EXISTS. #1954 unfreezes landing copy. A leftover sweep can
// put Frapp back in metadata titles, JSON-LD, or the lockup aria-label,
// switch a title to single quotes the first lock used to miss, or add a
// third metadata site the hardcoded paths would miss. USPTO stay on
// 1901. Leave store-name uniqueness on 1829. Landing visual tokens
// (Geist, bone/bronze) stay frozen until the visual reskin.
//
// SCOPE. Landing metadata titles, JSON-LD SoftwareApplication / brand
// names, the lockup aria-label, and the spec visual-freeze banner. Do
// not restyle Geist/bone tokens here. Do not walk apps/web (those
// titles are already Signet).

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

const HOME_TITLE = "Signet — Ask your chapter anything.";
const SUPPORT_TITLE = "Support — Signet";

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
      if (!/Signet/.test(title)) problems.push(`${rel}:missing-signet`);
      if (/Frapp/.test(title)) problems.push(`${rel}:frapp`);
    }
  }
  if (found.length < MIN_METADATA_TITLES) {
    problems.push("landing must keep the Signet metadata titles");
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
  if (!names.includes("Signet")) {
    problems.push("SoftwareApplication name");
  }
  if (names.filter((name) => name === "Signet").length !== 2) {
    problems.push("application + brand");
  }
  if (names.includes("Frapp")) {
    problems.push("JSON-LD must not name Frapp");
  }
  return problems;
}

export function chromeSurfaceProblems({ lockup, spec }) {
  const problems = [];
  if (!/aria-label=["']Signet["']/.test(lockup)) {
    problems.push("lockup aria-label must be Signet");
  }
  if (/aria-label=["']Frapp["']/.test(lockup)) {
    problems.push("lockup aria-label must not be Frapp");
  }
  if (!/> \*\*VISUAL FREEZE \(bone\/bronze\/Geist\)\.\*\*/.test(spec)) {
    problems.push("spec must keep the visual-freeze banner");
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

test("landing metadata titles stay Signet, not Frapp", () => {
  assert.deepEqual(metadataTitleProblems(liveMetadataFiles()), []);
  assert.deepEqual(
    frozenTitleProblems({
      layout: readRepo(LAYOUT),
      support: readRepo(SUPPORT),
    }),
    [],
  );
});

test("JSON-LD application and brand names stay Signet", () => {
  assert.deepEqual(jsonLdProblems(readRepo(HOME)), []);
});

test("lockup aria-label is Signet and spec keeps the visual-freeze banner", () => {
  assert.deepEqual(
    chromeSurfaceProblems({
      lockup: readRepo(LOCKUP),
      spec: readRepo(SPEC),
    }),
    [],
  );
});

test("putting Frapp in a layout metadata title fails", () => {
  const problems = metadataTitleProblems([
    {
      rel: LAYOUT,
      source: readRepo(LAYOUT).replaceAll(HOME_TITLE, "Frapp — The Operating System for Greek Life"),
    },
    { rel: SUPPORT, source: readRepo(SUPPORT) },
  ]);
  assert.ok(
    problems.some((problem) => problem.includes("frapp")),
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
    problems.some((problem) => problem.includes("Signet metadata titles")),
    problems.join("; "),
  );
});

test("a single-quoted Frapp title is collected", () => {
  assert.deepEqual(
    collectMetadataTitles(
      `export const metadata = {\n  title: 'Frapp — Privacy',\n};\n`,
    ),
    ["Frapp — Privacy"],
  );
});

test("a third JS-style Frapp metadata site fails the walk", () => {
  const rel = "apps/landing/app/privacy/page.tsx";
  const source = "export const metadata = {\n  title: 'Frapp — Privacy',\n};\n";
  assert.equal(isMetadataFile(source), true);
  assert.deepEqual(metadataTitleProblems([{ rel, source }]), [
    `${rel}:missing-signet`,
    `${rel}:frapp`,
    "landing must keep the Signet metadata titles",
  ]);
});

test("putting Frapp in JSON-LD fails", () => {
  const problems = jsonLdProblems(
    readRepo(HOME).replace('name: "Signet"', 'name: "Frapp"'),
  );
  assert.ok(
    problems.some((problem) => problem.includes("Frapp") || problem.includes("Signet")),
    problems.join("; "),
  );
});

test("dropping the lockup aria-label fails", () => {
  const problems = chromeSurfaceProblems({
    lockup: readRepo(LOCKUP).replace('aria-label="Signet"', 'aria-label="Frapp"'),
    spec: readRepo(SPEC),
  });
  assert.ok(
    problems.some((problem) => problem.includes("aria-label")),
    problems.join("; "),
  );
});

test("dropping the visual-freeze banner fails", () => {
  const problems = chromeSurfaceProblems({
    lockup: readRepo(LOCKUP),
    spec: readRepo(SPEC).replace(
      "> **VISUAL FREEZE (bone/bronze/Geist).**",
      "> **UNFROZEN (Signet).**",
    ),
  });
  assert.ok(
    problems.some((problem) => problem.includes("visual-freeze banner")),
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
