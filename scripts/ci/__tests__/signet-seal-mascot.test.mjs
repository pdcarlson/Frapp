// Locks Signet's intended mascot as a seal (the animal).
//
// WHY THIS EXISTS. Brand-identity records the animal, the USPTO ship-ban,
// and the wax-seal mark ban. Assets points at the same animal and forbids
// a piecemeal restyle. The first lock only read those two paths. A leftover
// sweep can put Frapp in the mascot line, drop the heading, drop the animal
// wording, drop the USPTO ban, treat a wax seal as the mascot, or add a
// third spec site the hardcoded paths would miss. It can also point the
// walker at landing (frozen Frapp) or apps (no commissioned art this slice).
// Leftover 1959. USPTO stay on 1901. Leave landing Frapp on 1954. Leave
// store-name on 1829. Do not restyle icons in this leftover.
//
// SCOPE. Markdown under spec/. Do not walk apps/ or docs/. No raster/SVG
// mascot ships in this first slice — do not start an asset pass here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const LOCK = fileURLToPath(import.meta.url);
const SPEC_ROOT = join(REPO_ROOT, "spec");

const BRAND = "spec/ui/brand-identity.md";
const ASSETS = "spec/ui/assets.md";
const EXPECTED_SITES = [ASSETS, BRAND].sort();

/** Brand heading + assets pointer. A third spec mascot site is drift. */
const MIN_MASCOT_SITES = 2;

const SKIP_DIRS = new Set(["node_modules", "dist", ".next", "coverage"]);

function readRepo(rel) {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

function walkMarkdown(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...walkMarkdown(path));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    out.push(path);
  }
  return out;
}

export function isMascotSite(source) {
  return /\bmascot\b/i.test(source);
}

export function mascotSites(files) {
  return files
    .filter((file) => isMascotSite(file.source))
    .map((file) => file.rel)
    .sort();
}

export function brandMascotProblems(brand) {
  const problems = [];
  if (!/^### The mascot$/m.test(brand)) {
    problems.push("brand must keep the mascot heading");
  }
  const heading = brand.indexOf("### The mascot");
  const mascot = heading >= 0 ? brand.slice(heading) : "";
  if (!/seal \(the animal\)/.test(mascot)) {
    problems.push("brand must name a seal (the animal)");
  }
  if (!/not commissioned/.test(mascot)) {
    problems.push("brand must say the mascot is not commissioned");
  }
  if (!/MUST NOT ship until the USPTO search/.test(mascot)) {
    problems.push("brand must keep the USPTO ship-ban");
  }
  if (!/No literal signet ring or wax seal/.test(brand)) {
    problems.push("brand must keep the wax-seal mark ban");
  }
  if (!/not a wax seal/i.test(mascot)) {
    problems.push("mascot section must say it is not a wax seal");
  }
  if (/Signet's mascot is a \*\*Frapp/i.test(mascot) || /Frapp's mascot/i.test(mascot)) {
    problems.push("brand must not name a Frapp mascot");
  }
  return problems;
}

export function assetsMascotProblems(assets) {
  const problems = [];
  if (!/intended mascot \(a seal, the animal\)/.test(assets) && !/animal mascot \(a seal, the animal\)/.test(assets)) {
    problems.push("assets must point at the animal mascot");
  }
  if (
    !/MUST NOT restyle the locked emblem piecemeal/.test(assets) &&
    !/MUST NOT restyle the legacy assets toward Signet piecemeal/.test(assets)
  ) {
    problems.push("assets must forbid a piecemeal restyle");
  }
  return problems;
}

export function walkedMascotProblems(files) {
  const problems = [];
  const sites = [];
  for (const { rel, source } of files) {
    if (!isMascotSite(source)) continue;
    sites.push(rel);
    if (/mascot is a (?:\*\*)?wax seal/i.test(source)) {
      problems.push(`${rel}:wax-mascot`);
    }
    if (/Frapp's mascot/i.test(source) || /mascot is a \*\*Frapp/i.test(source)) {
      problems.push(`${rel}:frapp-mascot`);
    }
  }
  sites.sort();
  if (sites.length < MIN_MASCOT_SITES) {
    problems.push("spec must keep both mascot sites");
  }
  for (const site of sites) {
    if (!EXPECTED_SITES.includes(site)) problems.push(`${site}:unexpected`);
  }
  for (const expected of EXPECTED_SITES) {
    if (!sites.includes(expected)) problems.push(`${expected}:missing`);
  }
  return problems;
}

export function lockSelfProblems(source) {
  const problems = [];
  const floor = source.match(/^const MIN_MASCOT_SITES = (\d+);?$/m);
  if (!floor || floor[1] !== "2") {
    problems.push("MIN_MASCOT_SITES must stay 2");
  }
  const specRoot = source.match(
    /^const SPEC_ROOT = join\(REPO_ROOT, "([^"]+)"\);?$/m,
  );
  if (!specRoot || specRoot[1] !== "spec") {
    problems.push("walker must stay on spec");
  }
  if (specRoot && specRoot[1].startsWith("apps/landing")) {
    problems.push("must not walk apps/landing");
  }
  if (specRoot && specRoot[1].startsWith("apps")) {
    problems.push("must not walk apps");
  }
  return problems;
}

function liveSpecFiles() {
  return walkMarkdown(SPEC_ROOT).map((path) => ({
    rel: relative(REPO_ROOT, path).replaceAll("\\", "/"),
    source: readFileSync(path, "utf8"),
  }));
}

function closerPattern() {
  return /\b(fixes|closes|close|fix|fixed|resolve|resolves|resolved)\s+#/i;
}

test("mascot spec stays a seal (the animal)", () => {
  assert.deepEqual(brandMascotProblems(readRepo(BRAND)), []);
  assert.deepEqual(assetsMascotProblems(readRepo(ASSETS)), []);
  const files = liveSpecFiles();
  assert.deepEqual(mascotSites(files), EXPECTED_SITES);
  assert.deepEqual(walkedMascotProblems(files), []);
});

test("putting Frapp in the brand mascot line fails", () => {
  const problems = brandMascotProblems(
    readRepo(BRAND).replace(
      "Signet's mascot is a **seal (the animal)**.",
      "Signet's mascot is a **Frapp beaver**.",
    ),
  );
  assert.ok(
    problems.some((problem) => problem.includes("seal (the animal)")),
    problems.join("; "),
  );
});

test("dropping the mascot heading fails", () => {
  const problems = brandMascotProblems(
    readRepo(BRAND).replace("### The mascot", "### The character"),
  );
  assert.ok(
    problems.some((problem) => problem.includes("heading")),
    problems.join("; "),
  );
});

test("dropping not commissioned fails", () => {
  const problems = brandMascotProblems(
    readRepo(BRAND).replace("**not commissioned**", "**already commissioned**"),
  );
  assert.ok(
    problems.some((problem) => problem.includes("not commissioned")),
    problems.join("; "),
  );
});

test("animal wording outside the mascot section does not satisfy the lock", () => {
  const brand = readRepo(BRAND)
    .replace("Signet's mascot is a **seal (the animal)**.", "Signet's mascot is a **beaver**.")
    .replace(
      "## 1. Identity\n",
      "## 1. Identity\n\nHistorical note: seal (the animal) lived in research.\n",
    );
  const problems = brandMascotProblems(brand);
  assert.ok(
    problems.some((problem) => problem.includes("seal (the animal)")),
    problems.join("; "),
  );
});

test("dropping the USPTO ship-ban fails", () => {
  const problems = brandMascotProblems(
    readRepo(BRAND).replace(
      "MUST NOT ship until the USPTO search",
      "MAY ship before the USPTO search",
    ),
  );
  assert.ok(
    problems.some((problem) => problem.includes("USPTO")),
    problems.join("; "),
  );
});

test("dropping the wax-seal mark ban fails", () => {
  const problems = brandMascotProblems(
    readRepo(BRAND).replace(
      "No literal signet ring or wax seal.",
      "Literal signet rings are allowed.",
    ),
  );
  assert.ok(
    problems.some((problem) => problem.includes("wax-seal mark ban")),
    problems.join("; "),
  );
});

test("calling the mascot a wax seal fails", () => {
  const problems = brandMascotProblems(
    readRepo(BRAND).replace("It is not a wax seal", "It may be a wax seal"),
  );
  assert.ok(
    problems.some((problem) => problem.includes("not a wax seal")),
    problems.join("; "),
  );
});

test("dropping the assets animal pointer fails", () => {
  const problems = assetsMascotProblems(
    readRepo(ASSETS).replace(
      "animal mascot (a seal, the animal)",
      "intended mascot (a beaver)",
    ),
  );
  assert.ok(
    problems.some((problem) => problem.includes("animal mascot")),
    problems.join("; "),
  );
});

test("dropping the piecemeal restyle ban fails", () => {
  const problems = assetsMascotProblems(
    readRepo(ASSETS).replace(
      "MUST NOT restyle the locked emblem piecemeal",
      "MAY restyle the locked emblem piecemeal",
    ),
  );
  assert.ok(
    problems.some((problem) => problem.includes("piecemeal")),
    problems.join("; "),
  );
});

test("a third spec mascot site fails the walk", () => {
  const rel = "spec/product/positioning.md";
  const source = "Signet's mascot is a beaver.\n";
  const files = [
    { rel: BRAND, source: readRepo(BRAND) },
    { rel: ASSETS, source: readRepo(ASSETS) },
    { rel, source },
  ];
  assert.equal(isMascotSite(source), true);
  assert.deepEqual(
    walkedMascotProblems(files).filter((problem) => problem.startsWith(rel)),
    [`${rel}:unexpected`],
  );
});

test("a Frapp mascot on a walked site fails", () => {
  const rel = BRAND;
  const source = "Frapp's mascot is a beaver.\n";
  assert.deepEqual(walkedMascotProblems([{ rel, source }]), [
    `${rel}:frapp-mascot`,
    "spec must keep both mascot sites",
    `${ASSETS}:missing`,
  ]);
});

test("walker stays on spec and keeps the floor", () => {
  assert.deepEqual(lockSelfProblems(readFileSync(LOCK, "utf8")), []);
});

test("pointing the walker at landing fails", () => {
  const problems = lockSelfProblems(
    readFileSync(LOCK, "utf8").replace(
      'const SPEC_ROOT = join(REPO_ROOT, "spec")',
      'const SPEC_ROOT = join(REPO_ROOT, "apps/landing")',
    ),
  );
  assert.ok(
    problems.some((problem) => problem.includes("apps/landing")),
    problems.join("; "),
  );
});

test("dropping MIN_MASCOT_SITES below 2 fails", () => {
  const problems = lockSelfProblems(
    readFileSync(LOCK, "utf8").replace(
      "const MIN_MASCOT_SITES = 2",
      "const MIN_MASCOT_SITES = 1",
    ),
  );
  assert.ok(
    problems.some((problem) => problem.includes("MIN_MASCOT_SITES")),
    problems.join("; "),
  );
});

test("refuses a GitHub closer next to an issue number", () => {
  assert.doesNotMatch(readFileSync(LOCK, "utf8"), closerPattern());
  assert.doesNotMatch(readRepo(BRAND), closerPattern());
  assert.doesNotMatch(readRepo(ASSETS), closerPattern());
});
