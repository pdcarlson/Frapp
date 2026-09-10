// Locks the customer-visible auth wordmark and tagline on Signet.
//
// WHY THIS EXISTS. Mobile sign-in and the web pre-auth column already say
// Signet / "Ask your chapter anything." #1950 locks metadata titles only.
// A leftover sweep can put Frapp back in the visible wordmark, switch the
// title to single quotes the first lock used to miss, add a third
// AuthScreen title=Signet site the hardcoded paths would miss, or walk
// landing (copy is Signet; visual tokens still frozen). #1955.
//
// SCOPE. Rendered title/subtitle props (web) and title/subtitle Text
// nodes (mobile). Do not scan whole web auth files for Frapp — those files
// keep historical Frapp comments. Mobile sign-in has none, so a file-wide
// Frapp ban is safe there. Leave app.json slug / scheme / bundle id on the
// deferred rename. Landing copy is Signet (1954). Do not lock join / sign-up / no-access
// titles (those are not the product wordmark).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const LOCK = fileURLToPath(import.meta.url);
const WEB_APP = join(REPO_ROOT, "apps/web/app");
const MOBILE_AUTH = join(REPO_ROOT, "apps/mobile/app/(auth)");

const MOBILE_SIGN_IN = "apps/mobile/app/(auth)/sign-in.tsx";
const WEB_HOME = "apps/web/app/page.tsx";
const WEB_SIGN_IN = "apps/web/app/sign-in/page.tsx";
const TAGLINE = "Ask your chapter anything.";

/** Home has one wordmark. Sign-in keeps the form and Suspense fallback. */
const MIN_HOME_WORDMARKS = 1;
const MIN_SIGN_IN_WORDMARKS = 2;

const EXPECTED_SITES = [MOBILE_SIGN_IN, WEB_HOME, WEB_SIGN_IN].sort();
const SKIP_DIRS = new Set(["node_modules", "dist", ".next", "coverage"]);

function readRepo(rel) {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

function literal(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

export function collectMobileWordmark(source) {
  const match = source.match(/<Text style=\{styles\.title\}>([^<]*)<\/Text>/);
  return match ? match[1] : null;
}

export function isAuthWordmarkSite(source) {
  const webTitles = collectWebWordmarks(source);
  if (webTitles.includes("Signet") || webTitles.includes("Frapp")) return true;
  const mobile = collectMobileWordmark(source);
  return mobile === "Signet" || mobile === "Frapp";
}

export function authWordmarkSites() {
  return [...walk(WEB_APP), ...walk(MOBILE_AUTH)]
    .filter((path) => isAuthWordmarkSite(readFileSync(path, "utf8")))
    .map((path) => relative(REPO_ROOT, path).replaceAll("\\", "/"))
    .sort();
}

export function walkedWordmarkProblems(files) {
  const problems = [];
  for (const { rel, source } of files) {
    for (const title of collectWebWordmarks(source)) {
      if (title === "Frapp") problems.push(`${rel}:title`);
    }
    for (const subtitle of collectWebTaglines(source)) {
      if (/\bFrapp\b/.test(subtitle)) problems.push(`${rel}:subtitle`);
    }
    const mobile = collectMobileWordmark(source);
    if (mobile === "Frapp") problems.push(`${rel}:mobile-title`);
  }
  return problems;
}

export function authWordmarkLockProblems({ mobile, home, signIn }) {
  const problems = [];
  if (!/<Text style=\{styles\.title\}>Signet<\/Text>/.test(mobile)) {
    problems.push("mobile sign-in title must be Signet");
  }
  if (
    !new RegExp(
      `<Text style=\\{styles\\.subtitle\\}>${literal(TAGLINE)}</Text>`,
    ).test(mobile)
  ) {
    problems.push("mobile sign-in subtitle must be the Signet tagline");
  }
  if (/<Text style=\{styles\.title\}>Frapp<\/Text>/.test(mobile)) {
    problems.push("mobile sign-in title must not be Frapp");
  }
  if (/\bFrapp\b/.test(mobile)) {
    problems.push("mobile sign-in must not name Frapp");
  }

  const homeTitles = collectWebWordmarks(home).filter((title) => title === "Signet");
  const signInTitles = collectWebWordmarks(signIn).filter(
    (title) => title === "Signet",
  );
  if (homeTitles.length < MIN_HOME_WORDMARKS) {
    problems.push("web home must keep the Signet wordmark");
  }
  if (signInTitles.length < MIN_SIGN_IN_WORDMARKS) {
    problems.push("web sign-in must keep the form and Suspense fallback wordmarks");
  }
  if (collectWebWordmarks(home).includes("Frapp")) {
    problems.push("web home title must not be Frapp");
  }
  if (collectWebWordmarks(signIn).includes("Frapp")) {
    problems.push("web sign-in title must not be Frapp");
  }

  const homeTaglines = collectWebTaglines(home).filter((line) => line === TAGLINE);
  const signInTaglines = collectWebTaglines(signIn).filter(
    (line) => line === TAGLINE,
  );
  if (homeTaglines.length < MIN_HOME_WORDMARKS) {
    problems.push("web home must keep the Signet tagline");
  }
  if (signInTaglines.length < MIN_SIGN_IN_WORDMARKS) {
    problems.push("web sign-in must keep the form and Suspense fallback taglines");
  }
  if (collectWebTaglines(home).some((line) => /\bFrapp\b/.test(line))) {
    problems.push("web home subtitle must not name Frapp");
  }
  if (collectWebTaglines(signIn).some((line) => /\bFrapp\b/.test(line))) {
    problems.push("web sign-in subtitle must not name Frapp");
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
  const mobileAuth = source.match(
    /^const MOBILE_AUTH = join\(REPO_ROOT, "([^"]+)"\);?$/m,
  );
  if (!mobileAuth || mobileAuth[1] !== "apps/mobile/app/(auth)") {
    problems.push("walker must stay on apps/mobile/app/(auth)");
  }
  if (!/title=\(\?:\["'\]/.test(source)) {
    problems.push("must collect single-quoted and double-quoted titles");
  }
  if (/doesNotMatch\(\s*home[\s\S]{0,80}\\bFrapp\\b/.test(source)) {
    problems.push("must not scan whole web auth files for Frapp");
  }
  return problems;
}

function liveWordmarkFiles() {
  return [...walk(WEB_APP), ...walk(MOBILE_AUTH)].map((path) => ({
    rel: relative(REPO_ROOT, path).replaceAll("\\", "/"),
    source: readFileSync(path, "utf8"),
  }));
}

test("auth wordmarks stay Signet", () => {
  assert.deepEqual(
    authWordmarkLockProblems({
      mobile: readRepo(MOBILE_SIGN_IN),
      home: readRepo(WEB_HOME),
      signIn: readRepo(WEB_SIGN_IN),
    }),
    [],
  );
  assert.deepEqual(authWordmarkSites(), EXPECTED_SITES);
  assert.deepEqual(walkedWordmarkProblems(liveWordmarkFiles()), []);
});

test("putting Frapp in the mobile wordmark fails", () => {
  const problems = authWordmarkLockProblems({
    mobile: readRepo(MOBILE_SIGN_IN).replace(
      "<Text style={styles.title}>Signet</Text>",
      "<Text style={styles.title}>Frapp</Text>",
    ),
    home: readRepo(WEB_HOME),
    signIn: readRepo(WEB_SIGN_IN),
  });
  assert.ok(
    problems.some((problem) => problem.includes("mobile sign-in title")),
    problems.join("; "),
  );
});

test("putting Frapp in a web AuthScreen title fails", () => {
  const problems = authWordmarkLockProblems({
    mobile: readRepo(MOBILE_SIGN_IN),
    home: readRepo(WEB_HOME).replace('title="Signet"', 'title="Frapp"'),
    signIn: readRepo(WEB_SIGN_IN),
  });
  assert.ok(
    problems.some((problem) => problem.includes("web home title")),
    problems.join("; "),
  );
});

test("dropping a sign-in Suspense fallback wordmark fails", () => {
  const problems = authWordmarkLockProblems({
    mobile: readRepo(MOBILE_SIGN_IN),
    home: readRepo(WEB_HOME),
    signIn: readRepo(WEB_SIGN_IN).replace(
      'title="Signet"',
      'title="Create your account"',
    ),
  });
  assert.ok(
    problems.some((problem) => problem.includes("Suspense fallback")),
    problems.join("; "),
  );
});

test("a third JS-style Frapp wordmark site fails the walk", () => {
  const rel = "apps/web/app/join/page.tsx";
  const source = '<AuthScreen title={\'Frapp\'} subtitle="Ask your chapter anything." />\n';
  assert.equal(isAuthWordmarkSite(source), true);
  assert.deepEqual(walkedWordmarkProblems([{ rel, source }]), [`${rel}:title`]);
});

test("a single-quoted Frapp title is collected", () => {
  assert.deepEqual(collectWebWordmarks("<AuthScreen title='Frapp' />"), [
    "Frapp",
  ]);
});

test("walker stays on web app + mobile auth and keeps the floors", () => {
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
