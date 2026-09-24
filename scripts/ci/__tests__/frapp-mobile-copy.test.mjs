// Locks the mobile binary's copy on Frapp, the name ADR-25 gives the product.
//
// WHY THIS EXISTS. ADR-25 step 2 moved every string the mobile app shows off
// "Signet". "Signet" survives in apps/mobile only as the design system's
// internal name: token types (`SignetTokens`), the `@repo/theme/signet`
// import, and comments about the design system. Each binary stays exactly as
// shipped until its user updates from the store, so a string that slips back
// is a store update to fix, not a deploy. Five earlier locks pinned slices of
// this surface on Signet; the three that spanned surfaces had their mobile
// halves split out into this file (auth wordmark, calendar ICS, the ops-nudge
// payment fixtures), and signet-mobile-permissions became
// frapp-mobile-permissions.
//
// WHAT IT CHECKS.
// - A walk of apps/mobile's non-spec sources (app.json included): no whole
//   word "Signet" outside a comment, and no signet- download filename. The
//   walk is what makes the pinned sites below not the whole story: a new
//   screen that says Signet fails here without anyone listing it.
// - Every `Settings → <name>` recovery path names `expo.name` from app.json,
//   because iOS Settings lists the app under that name (ADR-25 step 2).
// - The sign-in wordmark and tagline, the calendar ICS PRODID and filename
//   fallback, and the spec fixtures for the payment copy.
//
// TWO TAGLINES. The web pre-auth column keeps the brand tagline. Mobile
// sign-in carries the landing's D8 line instead, because a build without Ask
// must not open on "Ask your chapter anything." for App Review (#2298, owner
// decision 2026-09-22). Put the brand line back on mobile in the slice that
// ships Ask.
//
// SCOPE. apps/mobile only. The web, API and landing surfaces rename in
// ADR-25 steps 3 to 5, and their locks still pin what they ship today. The
// permanent identifiers (bundle id live.frapp.mobile, slug and scheme frapp,
// the @frapp.live ICS UID host) are not copy and are not this lock's.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MOBILE_ROOT = join(REPO_ROOT, "apps/mobile");
const LOCK = fileURLToPath(import.meta.url);

const APP_JSON = "apps/mobile/app.json";
const SIGN_IN = "apps/mobile/app/(auth)/sign-in.tsx";
const CALENDAR = "apps/mobile/lib/calendar-export.ts";
const STRIPE_SPEC = "apps/mobile/lib/payments/stripe.spec.ts";
const BALANCE_SPEC = "apps/mobile/components/dues/balance-card.spec.tsx";

export const APP_NAME = "Frapp";
const MOBILE_TAGLINE = "Everything your chapter needs is already in chat.";
const PRODID = "PRODID:-//Frapp//Chapter Events//EN";

/** study.tsx and the location primer. A path dropped to pass must fail. */
const MIN_SETTINGS_PATHS = 2;

const SKIP_DIRS = new Set(["node_modules", "dist", ".expo", "coverage", "ios", "android"]);
const SOURCE_EXT = /\.(?:json|js|ts|tsx)$/;

function readRepo(rel) {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

function literal(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function relOf(path) {
  return relative(REPO_ROOT, path).replaceAll("\\", "/");
}

/** Non-spec sources by default; `specs: true` returns only the specs. */
function walkMobile(dir = MOBILE_ROOT, { specs = false } = {}) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...walkMobile(path, { specs }));
      continue;
    }
    if (!entry.isFile() || !SOURCE_EXT.test(entry.name)) continue;
    if (/\.spec\./.test(entry.name) !== specs) continue;
    out.push(path);
  }
  return out;
}

/**
 * Whether `index` sits inside a comment. A `//` counts only outside a quoted
 * string on its line, so `"PRODID:-//Signet//…"` and `"https://…"` stay code.
 * A block comment is open when the last `/*` before `index` has no `*\/`
 * after it. Line-local on purpose: a quote miscounted in JSX text can only
 * misjudge the rest of that one line.
 */
export function isInComment(source, index) {
  const open = source.lastIndexOf("/*", index);
  if (open !== -1 && open > source.lastIndexOf("*/", index)) return true;
  const lineStart = source.lastIndexOf("\n", index - 1) + 1;
  let quote = null;
  for (let i = lineStart; i < index; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === "\\") i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "/" && source[i + 1] === "/") return true;
  }
  return false;
}

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

/** `Signet` as a whole word outside comments; `SignetTokens` is not a hit. */
export function signetCopyProblems(files) {
  const problems = [];
  for (const { rel, source } of files) {
    for (const match of source.matchAll(/\bSignet\b/g)) {
      if (isInComment(source, match.index)) continue;
      problems.push(`${rel}:${lineOf(source, match.index)}`);
    }
  }
  return problems;
}

/** A Save-as name that still starts signet-. Design-system files are not downloads. */
export const SIGNET_DOWNLOAD_NAME = /\bsignet-[^\n]{0,80}?\.(?:ics|csv|pdf)\b/gi;

export function signetDownloadNameProblems(files) {
  const problems = [];
  for (const { rel, source } of files) {
    for (const match of source.matchAll(SIGNET_DOWNLOAD_NAME)) {
      if (isInComment(source, match.index)) continue;
      problems.push(`${rel}:${lineOf(source, match.index)}`);
    }
  }
  return problems;
}

/** Every `Settings → X` path, with X the word iOS Settings must list. */
export function collectSettingsPaths(files) {
  const found = [];
  for (const { rel, source } of files) {
    for (const match of source.matchAll(/Settings → ([A-Za-z][\w-]*)/g)) {
      if (isInComment(source, match.index)) continue;
      found.push({ rel, line: lineOf(source, match.index), name: match[1] });
    }
  }
  return found;
}

export function settingsPathProblems(files, expoName) {
  const problems = [];
  const paths = collectSettingsPaths(files);
  if (paths.length < MIN_SETTINGS_PATHS) {
    problems.push(`must keep at least ${MIN_SETTINGS_PATHS} Settings → ${expoName} paths`);
  }
  for (const path of paths) {
    if (path.name !== expoName) {
      problems.push(`${path.rel}:${path.line} names Settings → ${path.name}, not ${expoName}`);
    }
  }
  return problems;
}

export function expoNameProblems(appJson) {
  const name = JSON.parse(appJson).expo?.name;
  return name === APP_NAME ? [] : [`expo.name must be ${APP_NAME}, not ${name}`];
}

export function pinnedSiteProblems({ signIn, calendar }) {
  const problems = [];
  if (!new RegExp(`<Text style=\\{styles\\.title\\}>${APP_NAME}</Text>`).test(signIn)) {
    problems.push(`mobile sign-in title must be ${APP_NAME}`);
  }
  // `\s*` because Prettier moves a long JSX text child onto its own line, and
  // JSX drops that surrounding whitespace, so both spellings render the same.
  if (
    !new RegExp(
      `<Text style=\\{styles\\.subtitle\\}>\\s*${literal(MOBILE_TAGLINE)}\\s*</Text>`,
    ).test(signIn)
  ) {
    problems.push("mobile sign-in subtitle must be the mobile tagline");
  }
  if (!new RegExp(literal(PRODID)).test(calendar)) {
    problems.push(`calendar export must ship ${PRODID}`);
  }
  if (!/\|\| "frapp-event"\}\.ics/.test(calendar)) {
    problems.push("calendar export must fall back to frapp-event.ics");
  }
  return problems;
}

export function paymentFixtureProblems({ stripeSpec, balanceSpec }) {
  const problems = [];
  if (!/merchantDisplayName:\s*"Frapp"/.test(stripeSpec)) {
    problems.push(`${STRIPE_SPEC} must pass merchantDisplayName Frapp`);
  }
  if (/merchantDisplayName:\s*"Signet"/.test(stripeSpec)) {
    problems.push(`${STRIPE_SPEC} must not pass merchantDisplayName Signet`);
  }
  if (!/installed Frapp build/.test(balanceSpec)) {
    problems.push(`${BALANCE_SPEC} must fixture installed Frapp build`);
  }
  if (/installed Signet build/.test(balanceSpec)) {
    problems.push(`${BALANCE_SPEC} must not fixture installed Signet build`);
  }
  return problems;
}

/**
 * Specs keep design-system test names ("no Signet map"), so they are not
 * walked for the word. They are walked for the two payment fixtures a sweep
 * would copy back into stripe.ts or the balance card.
 */
export function signetFixtureProblems(files) {
  const problems = [];
  for (const { rel, source } of files) {
    if (/merchantDisplayName:\s*"Signet"/.test(source)) {
      problems.push(`${rel}:merchantDisplayName Signet`);
    }
    if (/installed Signet build/.test(source)) {
      problems.push(`${rel}:installed Signet build`);
    }
  }
  return problems;
}

export function lockSelfProblems(source) {
  const problems = [];
  const name = source.match(/^export const APP_NAME = "([^"]+)";?$/m);
  if (!name || name[1] !== "Frapp") {
    problems.push("APP_NAME must stay Frapp");
  }
  const mobileRoot = source.match(/^const MOBILE_ROOT = join\(REPO_ROOT, "([^"]+)"\);?$/m);
  if (!mobileRoot || mobileRoot[1] !== "apps/mobile") {
    problems.push("walker must stay on apps/mobile");
  }
  const floor = source.match(/^const MIN_SETTINGS_PATHS = (\d+);?$/m);
  if (!floor || floor[1] !== "2") {
    problems.push("MIN_SETTINGS_PATHS must stay 2");
  }
  if (!/SOURCE_EXT = \/\\\.\(\?:json\|/.test(source)) {
    problems.push("walker must read app.json, not only code");
  }
  return problems;
}

function liveFiles(options) {
  return walkMobile(MOBILE_ROOT, options).map((path) => ({
    rel: relOf(path),
    source: readFileSync(path, "utf8"),
  }));
}

test("the mobile surface says Frapp, never Signet", () => {
  const files = liveFiles();
  assert.ok(files.some((file) => file.rel === APP_JSON), "walk must include app.json");
  assert.deepEqual(expoNameProblems(readRepo(APP_JSON)), []);
  assert.deepEqual(signetCopyProblems(files), []);
  assert.deepEqual(signetDownloadNameProblems(files), []);
  assert.deepEqual(settingsPathProblems(files, JSON.parse(readRepo(APP_JSON)).expo.name), []);
  assert.deepEqual(
    pinnedSiteProblems({ signIn: readRepo(SIGN_IN), calendar: readRepo(CALENDAR) }),
    [],
  );
  assert.deepEqual(
    paymentFixtureProblems({
      stripeSpec: readRepo(STRIPE_SPEC),
      balanceSpec: readRepo(BALANCE_SPEC),
    }),
    [],
  );
  const specs = liveFiles({ specs: true });
  assert.ok(specs.some((file) => file.rel === STRIPE_SPEC), "spec walk must reach stripe.spec.ts");
  assert.deepEqual(signetFixtureProblems(specs), []);
});

test("a Signet string, JSX text or JSON value fails the walk", () => {
  const files = [
    { rel: "a.ts", source: 'const reason = "Signet needs your photos.";\n' },
    { rel: "b.tsx", source: "<Text>\n  Return to Signet to resume.\n</Text>\n" },
    { rel: "c.json", source: '{ "expo": { "name": "Signet" } }\n' },
    { rel: "d.ts", source: 'const id = "PRODID:-//Signet//Chapter Events//EN";\n' },
  ];
  assert.deepEqual(signetCopyProblems(files), ["a.ts:1", "b.tsx:2", "c.json:1", "d.ts:1"]);
});

test("design-system names and comments are not copy", () => {
  const files = [
    { rel: "a.ts", source: 'import { SignetTokens } from "@repo/theme/signet";\n' },
    { rel: "b.ts", source: "// Signet gold, never the chapter accent.\n" },
    { rel: "c.ts", source: "/**\n * Signet is dark-only by design.\n */\n" },
    { rel: "d.tsx", source: "{/* Static: Signet is dark-only,\n   so no toggle. */}\n" },
    { rel: "e.ts", source: 'const url = "https://frapp.live"; // Signet tokens below\n' },
  ];
  assert.deepEqual(signetCopyProblems(files), []);
});

test("a signet- download filename fails, a design-system file name does not", () => {
  assert.deepEqual(
    signetDownloadNameProblems([
      { rel: "a.ts", source: 'const name = `${slug || "signet-event"}.ics`;\n' },
      { rel: "b.ts", source: 'const icon = require("./signet-emblem-B.png");\n' },
    ]),
    ["a.ts:1"],
  );
});

test("a Settings path that does not name expo.name fails", () => {
  const files = [
    { rel: "a.tsx", source: "Turn it on in Settings → Frapp → Location.\n" },
    { rel: "b.ts", source: '"Turn it on in Settings → Signet → Location."\n' },
  ];
  assert.deepEqual(settingsPathProblems(files, "Frapp"), [
    "b.ts:1 names Settings → Signet, not Frapp",
  ]);
});

test("renaming the binary without its Settings paths fails", () => {
  const files = liveFiles();
  const problems = settingsPathProblems(files, "Signet");
  assert.ok(problems.length >= MIN_SETTINGS_PATHS, problems.join("; "));
});

test("dropping the Settings paths below the floor fails", () => {
  assert.deepEqual(settingsPathProblems([], "Frapp"), [
    `must keep at least ${MIN_SETTINGS_PATHS} Settings → Frapp paths`,
  ]);
});

test("putting Signet back on expo.name fails", () => {
  const appJson = readRepo(APP_JSON).replace('"name": "Frapp"', '"name": "Signet"');
  assert.deepEqual(expoNameProblems(appJson), ["expo.name must be Frapp, not Signet"]);
});

test("putting Signet back on the sign-in wordmark or the ICS fails", () => {
  const problems = pinnedSiteProblems({
    signIn: readRepo(SIGN_IN).replace(
      "<Text style={styles.title}>Frapp</Text>",
      "<Text style={styles.title}>Signet</Text>",
    ),
    calendar: readRepo(CALENDAR)
      .replace(PRODID, "PRODID:-//Signet//Chapter Events//EN")
      .replace('"frapp-event"', '"signet-event"'),
  });
  assert.deepEqual(problems, [
    "mobile sign-in title must be Frapp",
    `calendar export must ship ${PRODID}`,
    "calendar export must fall back to frapp-event.ics",
  ]);
});

test("putting the brand tagline back on mobile sign-in fails", () => {
  const problems = pinnedSiteProblems({
    signIn: readRepo(SIGN_IN).replace(MOBILE_TAGLINE, "Ask your chapter anything."),
    calendar: readRepo(CALENDAR),
  });
  assert.deepEqual(problems, ["mobile sign-in subtitle must be the mobile tagline"]);
});

test("restoring a Signet payment fixture fails", () => {
  const problems = paymentFixtureProblems({
    stripeSpec: readRepo(STRIPE_SPEC).replaceAll(
      'merchantDisplayName: "Frapp"',
      'merchantDisplayName: "Signet"',
    ),
    balanceSpec: readRepo(BALANCE_SPEC).replace("installed Frapp build", "installed Signet build"),
  });
  assert.equal(problems.length, 4, problems.join("; "));
});

test("a third Signet payment fixture fails the spec walk", () => {
  assert.deepEqual(
    signetFixtureProblems([
      { rel: "apps/mobile/lib/payments/extra.spec.ts", source: 'merchantDisplayName: "Signet"' },
      { rel: "apps/mobile/components/dues/extra.spec.tsx", source: "installed Signet build" },
      { rel: "apps/mobile/lib/theme.spec.tsx", source: 'it("serves the fixed Signet dark tokens")' },
    ]),
    [
      "apps/mobile/lib/payments/extra.spec.ts:merchantDisplayName Signet",
      "apps/mobile/components/dues/extra.spec.tsx:installed Signet build",
    ],
  );
});

test("the lock keeps its name, root, floor and app.json", () => {
  assert.deepEqual(lockSelfProblems(readFileSync(LOCK, "utf8")), []);
  const problems = lockSelfProblems(
    readFileSync(LOCK, "utf8")
      .replace('export const APP_NAME = "Frapp"', 'export const APP_NAME = "Signet"')
      .replace('const MOBILE_ROOT = join(REPO_ROOT, "apps/mobile")', 'const MOBILE_ROOT = join(REPO_ROOT, "apps/landing")')
      .replace("const MIN_SETTINGS_PATHS = 2", "const MIN_SETTINGS_PATHS = 0")
      .replace("SOURCE_EXT = /\\.(?:json|js|ts|tsx)$/", "SOURCE_EXT = /\\.(?:js|ts|tsx)$/"),
  );
  assert.deepEqual(problems, [
    "APP_NAME must stay Frapp",
    "walker must stay on apps/mobile",
    "MIN_SETTINGS_PATHS must stay 2",
    "walker must read app.json, not only code",
  ]);
});

test("refuses a GitHub closer next to an issue number", () => {
  assert.doesNotMatch(
    readFileSync(LOCK, "utf8"),
    /\b(fixes|closes|close|fix|fixed|resolve|resolves|resolved)\s+#/i,
  );
});
