// Locks the mobile binary's copy on Frapp, the name ADR-25 gives the product.
//
// WHY THIS EXISTS. ADR-25 step 2 moved every string the mobile app shows off
// "Signet". "Signet" survives in apps/mobile only as the design system's
// internal name: token types (`SignetTokens`), the `@repo/theme/signet`
// import, and comments about the design system. Each binary stays exactly as
// shipped until its user updates from the store, so a string that slips back
// is a store update to fix, not a deploy. Five earlier locks pinned slices of
// this surface on Signet. Four spanned surfaces, and their mobile halves moved
// here: the auth wordmark, the calendar ICS, the ops-nudge payment fixtures,
// and the export-filename walk (apps/mobile left it, and the signet- download
// ban below replaces it). The fifth, signet-mobile-permissions, was mobile
// only and became frapp-mobile-permissions.
//
// WHAT IT CHECKS.
// - A walk of apps/mobile's non-spec sources (app.json included): no whole
//   word "Signet" and no signet- download filename anywhere but the comment
//   a line starts with (the note on LINE_BREAK in ../lib/copy-lines.mjs
//   says why, and names the one blind spot). A design-system note that names
//   Signet goes on its own comment line, not after code. The walk is what
//   makes the pinned sites below not the whole story: a new screen that says
//   Signet fails here without anyone listing it.
// - The two `Settings → <name> → Location` recovery paths (the study screen
//   and the location primer) are in code and name `expo.name` from app.json,
//   because iOS Settings lists the app under that name (ADR-25 step 2). iOS
//   18's `Settings → Apps → <name> → Location` counts too. Other `Settings →`
//   paths (in-app screens, system settings, other permissions) aren't judged
//   here: telling an app path from a system one takes more than a pattern,
//   and a Signet in any of them is still caught by the walk above.
// - The sign-in wordmark and tagline, the calendar ICS PRODID and filename
//   fallback, and the spec fixtures for the payment copy.
//
// TWO TAGLINES. The web pre-auth column keeps the brand tagline. Mobile
// sign-in carries the landing's D8 line instead, because a build without Ask
// must not open on "Ask your chapter anything." for App Review (#2298, owner
// decision 2026-09-22). Put the brand line back on mobile in the slice that
// ships Ask.
//
// SCOPE. apps/mobile only. The API renamed in ADR-25 step 3 and the web
// dashboard in step 4, and each has its own walk (frapp-api-copy.test.mjs,
// frapp-web-copy.test.mjs). Landing renames in step 5, and its lock still
// pins what it ships today. The
// permanent identifiers (bundle id live.frapp.mobile, slug and scheme frapp,
// the @frapp.live ICS UID host) are not copy and are not this lock's.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { copyMatches, inLeadingComment, LINE_BREAK, SIGNET_DOWNLOAD_NAME } from "../lib/copy-lines.mjs";

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

/** Where the location recovery path lives. A path dropped to pass must fail. */
const SETTINGS_SITES = [
  "apps/mobile/app/(tabs)/study.tsx",
  "apps/mobile/components/study/location-primer-sheet.tsx",
];

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

/** `Signet` as a whole word; `SignetTokens` is not a hit. */
export function signetCopyProblems(files) {
  return copyMatches(files, /\bSignet\b/g).map(({ rel, line }) => `${rel}:${line}`);
}

export function signetDownloadNameProblems(files) {
  return copyMatches(files, SIGNET_DOWNLOAD_NAME).map(({ rel, line }) => `${rel}:${line}`);
}

/** The line holding `index` in `source`, and `index`'s column in it. */
function lineAt(source, index) {
  let start = 0;
  for (const brk of source.slice(0, index).matchAll(new RegExp(LINE_BREAK.source, "g"))) {
    start = brk.index + brk[0].length;
  }
  const rest = source.slice(start);
  const end = rest.search(LINE_BREAK);
  return { text: end === -1 ? rest : rest.slice(0, end), column: index - start };
}

/**
 * Whether a `/*` before `index` is still open, read naively (a `"image/*"`
 * counts too). The close is searched from after the opener, so `/*\/` opens.
 */
function blockOpenBefore(source, index) {
  const open = source.lastIndexOf("/*", index);
  if (open === -1) return false;
  const close = source.indexOf("*/", open + 2);
  return close === -1 || close > index;
}

/**
 * Each pinned site must keep its `Settings → <expoName> → Location` path in
 * code. The path is matched over the whole source, so one Prettier wraps
 * after an arrow still counts. It counts only when it is certainly code: not
 * in its line's leading comment, not after a `//` or `/*` on its line, and
 * not below an open `/*`, so a comment can't stand in for a deleted path.
 * That last check is naive: it takes the nearest `/*` above the path, wherever
 * it sits (a string, a regex, a `//` comment, JSX text), and reports when that
 * opener's first `*\/` comes after the path or never. It fails closed, so when
 * the pin fails on copy that reads right, look at the nearest `/*` above it.
 * The first letter of `Settings`, `Apps` and `Location` may be either case,
 * and quotes around the name, escaped or not, are optional; the name itself
 * must match exactly.
 */
export function settingsPathProblems(files, expoName) {
  const problems = [];
  const pin = new RegExp(
    `[Ss]ettings\\s*→\\s*(?:[Aa]pps\\s*→\\s*)?\\\\?["'“‘]?${literal(expoName)}\\\\?["'”’]?\\s*→\\s*[Ll]ocation\\b`,
    "g",
  );
  for (const site of SETTINGS_SITES) {
    const file = files.find((candidate) => candidate.rel === site);
    const kept =
      file &&
      [...file.source.matchAll(pin)].some((match) => {
        const { text, column } = lineAt(file.source, match.index);
        const note = inLeadingComment(text, column) || /\/\/|\/\*/.test(text.slice(0, column));
        return !note && !blockOpenBefore(file.source, match.index);
      });
    if (!kept) problems.push(`${site} must keep its Settings → ${expoName} → Location path`);
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

/** The two fixtures must exist; signetFixtureProblems bans the Signet ones in every spec. */
export function paymentFixtureProblems({ stripeSpec, balanceSpec }) {
  const problems = [];
  if (!/merchantDisplayName:\s*"Frapp"/.test(stripeSpec)) {
    problems.push(`${STRIPE_SPEC} must pass merchantDisplayName Frapp`);
  }
  if (!/installed Frapp build/.test(balanceSpec)) {
    problems.push(`${BALANCE_SPEC} must fixture installed Frapp build`);
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
  if (
    !/^const SETTINGS_SITES = \[\n  "apps\/mobile\/app\/\(tabs\)\/study\.tsx",\n  "apps\/mobile\/components\/study\/location-primer-sheet\.tsx",\n\];$/m.test(
      source,
    )
  ) {
    problems.push("SETTINGS_SITES must keep both recovery paths");
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

// Every input below hid real copy from the scanner this lock used to have.
// Each line is judged alone now, so what came before it can't matter.
test("nothing on an earlier line can hide copy on a code line", () => {
  const files = [
    { rel: "a.ts", source: 'const accept = "image/*";\nconst r = "Signet needs your photos.";\n' },
    { rel: "b.json", source: '{\n  "assetBundlePatterns": ["**/*"],\n  "x": "Signet reads it."\n}\n' },
    { rel: "c.ts", source: 'const clean = url.replace(/\\/*$/, "");\nconst r = "Signet";\n/** doc */\n' },
    { rel: "d.ts", source: 'const re = /`/;\nconst g = `**/*.ts`;\nconst t = "Signet";\n' },
    { rel: "e.tsx", source: "<Text>\n  Upload files matching\n  /* or pick one\n</Text>\n<Text>Return to Signet.</Text>\n" },
    { rel: "f.tsx", source: "<Text>Press ` then</Text>\nconst css = `\n  /* all\n`;\n<Text>Return to Signet.</Text>\n" },
    { rel: "g.tsx", source: "<Text>Don't worry</Text><Picker accept={'image/*'} />\n<Text>Return to Signet.</Text>\n" },
    { rel: "h.ts", source: 'const accept = x//TODO: restore /* glob\nexport const r = "Signet";\n' },
    { rel: "i.ts", source: 'const pats = [\n  /x/, // plain\n  /`/g,\n];\nconst t = "Signet";\n' },
  ];
  assert.deepEqual(signetCopyProblems(files), [
    "a.ts:2",
    "b.json:3",
    "c.ts:2",
    "d.ts:3",
    "e.tsx:5",
    "f.tsx:5",
    "g.tsx:2",
    "h.ts:2",
    "i.ts:5",
  ]);
});

test("a comment earlier on the same line exempts nothing after it closes", () => {
  const files = [
    { rel: "a.tsx", source: "<Text>\n  {/* keep on one line */}Tap and//or hold to open Signet.\n</Text>\n" },
    { rel: "b.tsx", source: "/* x */ <Text>Type // to reply in Signet</Text>\n" },
    { rel: "c.ts", source: " * end of doc */ const t = \"Signet\";\n" },
    { rel: "d.tsx", source: "<Text>\n  Help lives at https://frapp.live/help. Return to Signet.\n</Text>\n" },
  ];
  assert.deepEqual(signetCopyProblems(files), ["a.tsx:2", "b.tsx:1", "c.ts:1", "d.tsx:2"]);
});

test("every JavaScript line break ends a comment line", () => {
  for (const brk of ["\r", "\r\n", "\u2028", "\u2029"]) {
    assert.deepEqual(
      signetCopyProblems([{ rel: "a.tsx", source: `// design note${brk}<Text>Welcome to Signet</Text>\n` }]),
      ["a.tsx:2"],
      JSON.stringify(brk),
    );
    assert.deepEqual(
      signetDownloadNameProblems([{ rel: "a.ts", source: `// note${brk}const f = "signet-events.ics";\n` }]),
      ["a.ts:2"],
      JSON.stringify(brk),
    );
  }
});

test("a design-system note names Signet only in the comment its line starts with", () => {
  const allowed = [
    { rel: "a.ts", source: 'import { SignetTokens } from "@repo/theme/signet";\n' },
    { rel: "b.ts", source: "// Signet gold, never the chapter accent.\n" },
    { rel: "c.ts", source: "/**\n * Signet is dark-only by design.\n */\n" },
    { rel: "d.tsx", source: "{/* Static: Signet is dark-only */}\n" },
    { rel: "e.ts", source: "/* Signet tokens */\n" },
  ];
  assert.deepEqual(signetCopyProblems(allowed), []);
  // After code, or on a star-less continuation line, it reports: fail closed.
  const reported = [
    { rel: "a.ts", source: "x; // Signet gold\n" },
    { rel: "b.ts", source: "foo(); /* Signet gold */ bar();\n" },
    { rel: "c.tsx", source: "{/* The\n    Signet gold ring */}\n" },
  ];
  assert.deepEqual(signetCopyProblems(reported), ["a.ts:1", "b.ts:1", "c.tsx:2"]);
});

test("a signet- download filename fails, a design-system file name does not", () => {
  assert.deepEqual(
    signetDownloadNameProblems([
      { rel: "a.ts", source: 'const name = `${slug || "signet-event"}.ics`;\n' },
      { rel: "b.ts", source: 'const icon = require("./signet-emblem-B.png");\n' },
      { rel: "c.ts", source: '/* was signet-events */ const name = "signet-dues.ics";\n' },
      { rel: "d.ts", source: "// the old fallback was signet-event.ics\n" },
    ]),
    ["a.ts:1", "c.ts:1"],
  );
});

const STUDY = SETTINGS_SITES[0];
const PRIMER = SETTINGS_SITES[1];
const recovery = (rel, name = "Frapp") => ({
  rel,
  source: `const r = "Turn it on in Settings → ${name} → Location.";\n`,
});

test("both pinned Settings paths must be in code and name expo.name", () => {
  assert.deepEqual(settingsPathProblems([recovery(STUDY), recovery(PRIMER)], "Frapp"), []);
  assert.deepEqual(settingsPathProblems([recovery(STUDY)], "Frapp"), [
    `${PRIMER} must keep its Settings → Frapp → Location path`,
  ]);
  const lost = `${PRIMER} must keep its Settings → Frapp → Location path`;
  for (const source of [
    "// Settings → Frapp → Location\n",
    "Linking.openSettings(); // was: Settings → Frapp → Location\n<Text>Turn location on.</Text>\n",
    "/*\n  old copy: Settings → Frapp → Location\n*/\n<Text>Turn location on.</Text>\n",
    "/*/\n  old copy: Settings → Frapp → Location\n*/\n<Text>Turn location on.</Text>\n",
    '<Text>Turn it on in Settings → Frapp → Photos.</Text>\n',
  ]) {
    assert.deepEqual(settingsPathProblems([recovery(STUDY), { rel: PRIMER, source }], "Frapp"), [lost]);
  }
  for (const source of [
    "<Text>\n  Turn it on in Settings →\n  Frapp → Location.\n</Text>\n",
    "<Text>Turn it on in Settings → Apps → Frapp → Location.</Text>\n",
    "<Text>Turn it on in settings → “Frapp” → location.</Text>\n",
    "<Text>Turn it on in settings → apps → Frapp → location.</Text>\n",
    'const m = "Turn it on in Settings → \\"Frapp\\" → Location.";\n',
  ]) {
    assert.deepEqual(settingsPathProblems([recovery(STUDY), { rel: PRIMER, source }], "Frapp"), []);
  }
  assert.deepEqual(settingsPathProblems([recovery(STUDY), recovery(PRIMER, "Signet")], "Frapp"), [lost]);
  assert.deepEqual(signetCopyProblems([recovery(PRIMER, "Signet")]), [`${PRIMER}:1`]);
});

test("renaming the binary without its Settings paths fails", () => {
  const problems = settingsPathProblems(liveFiles(), "Signet");
  assert.ok(problems.length >= SETTINGS_SITES.length, problems.join("; "));
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
  const stripeSpec = readRepo(STRIPE_SPEC).replaceAll(
    'merchantDisplayName: "Frapp"',
    'merchantDisplayName: "Signet"',
  );
  const balanceSpec = readRepo(BALANCE_SPEC).replace(
    "installed Frapp build",
    "installed Signet build",
  );
  assert.deepEqual(paymentFixtureProblems({ stripeSpec, balanceSpec }), [
    `${STRIPE_SPEC} must pass merchantDisplayName Frapp`,
    `${BALANCE_SPEC} must fixture installed Frapp build`,
  ]);
  assert.deepEqual(
    signetFixtureProblems([
      { rel: STRIPE_SPEC, source: stripeSpec },
      { rel: BALANCE_SPEC, source: balanceSpec },
    ]),
    [`${STRIPE_SPEC}:merchantDisplayName Signet`, `${BALANCE_SPEC}:installed Signet build`],
  );
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

test("the lock keeps its name, root, recovery sites and app.json", () => {
  assert.deepEqual(lockSelfProblems(readFileSync(LOCK, "utf8")), []);
  const problems = lockSelfProblems(
    readFileSync(LOCK, "utf8")
      .replace('export const APP_NAME = "Frapp"', 'export const APP_NAME = "Signet"')
      .replace('const MOBILE_ROOT = join(REPO_ROOT, "apps/mobile")', 'const MOBILE_ROOT = join(REPO_ROOT, "apps/landing")')
      .replace('  "apps/mobile/components/study/location-primer-sheet.tsx",\n', "")
      .replace("SOURCE_EXT = /\\.(?:json|js|ts|tsx)$/", "SOURCE_EXT = /\\.(?:js|ts|tsx)$/"),
  );
  assert.deepEqual(problems, [
    "APP_NAME must stay Frapp",
    "walker must stay on apps/mobile",
    "SETTINGS_SITES must keep both recovery paths",
    "walker must read app.json, not only code",
  ]);
});

test("refuses a GitHub closer next to an issue number", () => {
  assert.doesNotMatch(
    readFileSync(LOCK, "utf8"),
    /\b(fixes|closes|close|fix|fixed|resolve|resolves|resolved)\s+#/i,
  );
});

test("the blind spot: copy on a line that starts with comment punctuation", () => {
  // Pinned so that closing or widening it is a deliberate change.
  assert.deepEqual(
    signetCopyProblems([
      { rel: "a.ts", source: "const help = `\n* Signet reads your calendar\n`;\n" },
      { rel: "b.tsx", source: "<Text>\n  // Signet, in JSX text\n</Text>\n" },
    ]),
    [],
  );
});
