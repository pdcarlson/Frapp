// Locks the customer-visible web auth wordmark and tagline on Frapp.
//
// WHY THIS EXISTS. The web pre-auth column says Frapp under a locked
// tagline. #1950 locks metadata titles only. A leftover sweep can change the
// visible wordmark, switch the title to single quotes the first lock used to
// miss, add a third AuthScreen title=Frapp site the hardcoded paths would
// miss, or walk landing. #1955.
//
// ADR-25 NAMES THE PRODUCT FRAPP, and renamed it one surface at a time. Step
// 2 moved mobile sign-in to Frapp and split its half of this lock out into
// frapp-mobile-copy.test.mjs, along with the mobile tagline note. Step 4
// moved the web dashboard and flipped the rest: this lock was
// signet-auth-wordmark, the title became Frapp and Signet the banned word.
//
// SCOPE. Rendered title/subtitle props on apps/web/app. Do not scan whole
// web auth files for Signet — those files keep design-system comments and
// the SignetMark component. frapp-web-copy walks their copy lines.
// Do not lock join / sign-up / no-access titles (those are not the product
// wordmark).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const LOCK = fileURLToPath(import.meta.url);
const WEB_APP = join(REPO_ROOT, "apps/web/app");

const WEB_HOME = "apps/web/app/page.tsx";
const WEB_SIGN_IN = "apps/web/app/sign-in/page.tsx";
const TAGLINE = "Ask your chapter anything.";

/** Home has one wordmark. Sign-in keeps the form and Suspense fallback. */
const MIN_HOME_WORDMARKS = 1;
const MIN_SIGN_IN_WORDMARKS = 2;

const EXPECTED_SITES = [WEB_HOME, WEB_SIGN_IN].sort();
const SKIP_DIRS = new Set(["node_modules", "dist", ".next", "coverage"]);

function readRepo(rel) {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...walk(path));
      continue;
    }
    if (!entry.isFile() || !/\.(tsx|ts)$/.test(entry.name)) continue;
    if (/\.spec\./.test(entry.name)) continue;
    out.push(path);
  }
  return out;
}

export function collectWebWordmarks(source) {
  const titles = [];
  const pattern = /title=(?:["']([^"']+)["']|\{\s*["']([^"']+)["']\s*\})/g;
  for (const match of source.matchAll(pattern)) {
    titles.push(match[1] || match[2]);
  }
  return titles;
}

export function collectWebTaglines(source) {
  const found = [];
  const pattern = /subtitle=(?:["']([^"']+)["']|\{\s*["']([^"']+)["']\s*\})/g;
  for (const match of source.matchAll(pattern)) {
    found.push(match[1] || match[2]);
  }
  return found;
}

export function isAuthWordmarkSite(source) {
  const webTitles = collectWebWordmarks(source);
  return webTitles.includes("Frapp") || webTitles.includes("Signet");
}

export function authWordmarkSites() {
  return walk(WEB_APP)
    .filter((path) => isAuthWordmarkSite(readFileSync(path, "utf8")))
    .map((path) => relative(REPO_ROOT, path).replaceAll("\\", "/"))
    .sort();
}

export function walkedWordmarkProblems(files) {
  const problems = [];
  for (const { rel, source } of files) {
    for (const title of collectWebWordmarks(source)) {
      if (title === "Signet") problems.push(`${rel}:title`);
    }
    for (const subtitle of collectWebTaglines(source)) {
      if (/\bSignet\b/.test(subtitle)) problems.push(`${rel}:subtitle`);
    }
  }
  return problems;
}

export function authWordmarkLockProblems({ home, signIn }) {
  const problems = [];
  const homeTitles = collectWebWordmarks(home).filter((title) => title === "Frapp");
  const signInTitles = collectWebWordmarks(signIn).filter(
    (title) => title === "Frapp",
  );
  if (homeTitles.length < MIN_HOME_WORDMARKS) {
    problems.push("web home must keep the Frapp wordmark");
  }
  if (signInTitles.length < MIN_SIGN_IN_WORDMARKS) {
    problems.push("web sign-in must keep the form and Suspense fallback wordmarks");
  }
  if (collectWebWordmarks(home).includes("Signet")) {
    problems.push("web home title must not be Signet");
  }
  if (collectWebWordmarks(signIn).includes("Signet")) {
    problems.push("web sign-in title must not be Signet");
  }

  const homeTaglines = collectWebTaglines(home).filter((line) => line === TAGLINE);
  const signInTaglines = collectWebTaglines(signIn).filter(
    (line) => line === TAGLINE,
  );
  if (homeTaglines.length < MIN_HOME_WORDMARKS) {
    problems.push("web home must keep the brand tagline");
  }
  if (signInTaglines.length < MIN_SIGN_IN_WORDMARKS) {
    problems.push("web sign-in must keep the form and Suspense fallback taglines");
  }
  if (collectWebTaglines(home).some((line) => /\bSignet\b/.test(line))) {
    problems.push("web home subtitle must not name Signet");
  }
  if (collectWebTaglines(signIn).some((line) => /\bSignet\b/.test(line))) {
    problems.push("web sign-in subtitle must not name Signet");
  }
  return problems;
}

export function lockSelfProblems(source) {
  const problems = [];
  const homeFloor = source.match(/^const MIN_HOME_WORDMARKS = (\d+);?$/m);
  if (!homeFloor || homeFloor[1] !== "1") {
    problems.push("MIN_HOME_WORDMARKS must stay 1");
  }
  const signInFloor = source.match(/^const MIN_SIGN_IN_WORDMARKS = (\d+);?$/m);
  if (!signInFloor || signInFloor[1] !== "2") {
    problems.push("MIN_SIGN_IN_WORDMARKS must stay 2");
  }
  const webApp = source.match(/^const WEB_APP = join\(REPO_ROOT, "([^"]+)"\);?$/m);
  if (!webApp || webApp[1] !== "apps/web/app") {
    problems.push("walker must stay on apps/web/app");
  }
  if (webApp && webApp[1].startsWith("apps/landing")) {
    problems.push("must not walk apps/landing");
  }
  if (!/title=\(\?:\["'\]/.test(source)) {
    problems.push("must collect single-quoted and double-quoted titles");
  }
  if (/doesNotMatch\(\s*home[\s\S]{0,80}\\bSignet\\b/.test(source)) {
    problems.push("must not scan whole web auth files for Signet");
  }
  return problems;
}

function liveWordmarkFiles() {
  return walk(WEB_APP).map((path) => ({
    rel: relative(REPO_ROOT, path).replaceAll("\\", "/"),
    source: readFileSync(path, "utf8"),
  }));
}

test("web auth wordmarks say Frapp", () => {
  assert.deepEqual(
    authWordmarkLockProblems({
      home: readRepo(WEB_HOME),
      signIn: readRepo(WEB_SIGN_IN),
    }),
    [],
  );
  assert.deepEqual(authWordmarkSites(), EXPECTED_SITES);
  assert.deepEqual(walkedWordmarkProblems(liveWordmarkFiles()), []);
});

test("putting Signet back in a web AuthScreen title fails", () => {
  const problems = authWordmarkLockProblems({
    home: readRepo(WEB_HOME).replace('title="Frapp"', 'title="Signet"'),
    signIn: readRepo(WEB_SIGN_IN),
  });
  assert.ok(
    problems.some((problem) => problem.includes("web home title")),
    problems.join("; "),
  );
});

test("dropping a sign-in Suspense fallback wordmark fails", () => {
  const problems = authWordmarkLockProblems({
    home: readRepo(WEB_HOME),
    signIn: readRepo(WEB_SIGN_IN).replace(
      'title="Frapp"',
      'title="Create your account"',
    ),
  });
  assert.ok(
    problems.some((problem) => problem.includes("Suspense fallback")),
    problems.join("; "),
  );
});

test("a third JS-style Signet wordmark site fails the walk", () => {
  const rel = "apps/web/app/join/page.tsx";
  const source = '<AuthScreen title={\'Signet\'} subtitle="Ask your chapter anything." />\n';
  assert.equal(isAuthWordmarkSite(source), true);
  assert.deepEqual(walkedWordmarkProblems([{ rel, source }]), [`${rel}:title`]);
});

test("a single-quoted Signet title is collected", () => {
  assert.deepEqual(collectWebWordmarks("<AuthScreen title='Signet' />"), [
    "Signet",
  ]);
});

test("a Signet tagline fails the walk", () => {
  const rel = "apps/web/app/join/page.tsx";
  const source = '<AuthScreen title="Frapp" subtitle="Ask Signet anything." />\n';
  assert.deepEqual(walkedWordmarkProblems([{ rel, source }]), [`${rel}:subtitle`]);
});

test("walker stays on the web app and keeps the floors", () => {
  assert.deepEqual(lockSelfProblems(readFileSync(LOCK, "utf8")), []);
});

test("pointing the walker at landing fails", () => {
  const problems = lockSelfProblems(
    readFileSync(LOCK, "utf8").replace(
      'const WEB_APP = join(REPO_ROOT, "apps/web/app")',
      'const WEB_APP = join(REPO_ROOT, "apps/landing/app")',
    ),
  );
  assert.ok(
    problems.some((problem) => problem.includes("apps/landing")),
    problems.join("; "),
  );
});

test("dropping MIN_SIGN_IN_WORDMARKS below 2 fails", () => {
  const problems = lockSelfProblems(
    readFileSync(LOCK, "utf8").replace(
      "const MIN_SIGN_IN_WORDMARKS = 2",
      "const MIN_SIGN_IN_WORDMARKS = 1",
    ),
  );
  assert.ok(
    problems.some((problem) => problem.includes("MIN_SIGN_IN_WORDMARKS")),
    problems.join("; "),
  );
});

test("refuses a GitHub closer next to an issue number", () => {
  const lock = readFileSync(LOCK, "utf8");
  assert.doesNotMatch(
    lock,
    /\b(fixes|closes|close|fix|fixed|resolve|resolves|resolved)\s+#/i,
  );
});
