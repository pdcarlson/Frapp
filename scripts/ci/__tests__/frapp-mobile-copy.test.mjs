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
//   word "Signet" and no signet- download filename anywhere but a comment
//   that starts its line with `//`, `*`, `/*` or `{/*`. A design-system note
//   that names Signet goes on such a line, not after code. The walk is what
//   makes the pinned sites below not the whole story: a new screen that says
//   Signet fails here without anyone listing it.
// - Every `Settings → <name>` recovery path in code names `expo.name` from
//   app.json, because iOS Settings lists the app under that name (ADR-25
//   step 2), and at least two exist. A path in any comment is not a recovery
//   path and counts for neither.
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
 * The comment spans of one file, as `[start, end)` pairs. JSON has none, so a
 * `"**\/*"` glob in app.json can't hide the keys after it. For code, one pass
 * tracks strings, template literals (with `${…}` nesting) and regex literals,
 * so the `/*` in `"image/*"` or `/\/*$/`, the `//` in `"PRODID:-//…"` or
 * `/^https?:\/\//`, and a backtick in `/`/` all stay code.
 *
 * Comment openers are also judged by where they sit. A `//` opens a comment
 * anywhere except right after `:`, so a URL in JSX text stays code. A `/*`
 * opens one only first on its line, right after `{` (the JSX `{/* … *\/}`
 * form), or when `*\/` closes it later on the same line and the character
 * before it isn't a word character, `*`, `/`, `.` or `\`. So `image/*` and
 * `**\/*` stay code.
 *
 * It is a heuristic, not a parser, and on its own a misread can hide lines:
 * - A `//` in unquoted JSX text (`and//or`) reads as a comment to its line end,
 *   and swallows a backtick that opens a template on that line.
 * - A `/*` that starts a line of JSX text or of a misread template opens a
 *   block comment that runs to the next `*\/`.
 * - Whether a `/` starts a regex or divides is judged by what precedes it on
 *   its line (or, first on its line, by the line above unless that is a
 *   comment), which an unusual expression can defeat.
 * - A raw `'` or `"` in JSX text would miscount strings. Lint keeps them out
 *   (react/no-unescaped-entities, and `lint` runs with --max-warnings 0).
 * - A stray backtick in JSX text, which that rule allows, flips template
 *   tracking: template bodies read as code and code as template text.
 * So copyMatches doesn't take the scanner's word alone: a match counts as a
 * comment only when the comment holding it starts its line (`//`, `/*`, `{/*`,
 * or a `*` continuation line). Hiding copy then needs a misread and a line
 * that itself starts with `//`, `*`, `/*` or `{/*`: copy there, or code such
 * as a `*[Symbol.iterator]` method or a `* rate` continuation line.
 * Checked 2026-09-24 against the TypeScript compiler's comment ranges over
 * every js/ts/tsx file under apps/mobile, specs included: identical.
 */
export function commentRanges(rel, source) {
  if (rel.endsWith(".json")) return [];
  const ranges = [];
  const braces = []; // open-brace depth inside each `${`, so `}` knows when the template resumes
  let state = "code"; // code | line | block | ' | " | `
  let start = 0;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (state === "line") {
      if (char === "\n") {
        ranges.push([start, i]);
        state = "code";
      }
    } else if (state === "block") {
      if (char === "*" && next === "/") {
        ranges.push([start, i + 2]);
        state = "code";
        i += 1;
      }
    } else if (state === "'" || state === '"') {
      if (char === "\\") i += 1;
      else if (char === state || char === "\n") state = "code";
    } else if (state === "`") {
      if (char === "\\") i += 1;
      else if (char === "`") state = "code";
      else if (char === "$" && next === "{") {
        braces.push(0);
        state = "code";
        i += 1;
      }
    } else if (char === "/" && next === "/" && source[i - 1] !== ":") {
      state = "line";
      start = i;
      i += 1;
    } else if (char === "/" && next === "*" && opensBlock(source, i)) {
      state = "block";
      start = i;
      i += 1;
    } else if (char === "/") {
      i = regexEnd(source, i) ?? i;
    } else if (char === "'" || char === '"' || char === "`") {
      state = char;
    } else if (braces.length > 0 && char === "{") {
      braces[braces.length - 1] += 1;
    } else if (braces.length > 0 && char === "}") {
      if (braces[braces.length - 1] === 0) {
        braces.pop();
        state = "`";
      } else {
        braces[braces.length - 1] -= 1;
      }
    }
  }
  if (state === "line" || state === "block") ranges.push([start, source.length]);
  return ranges;
}

/** Whether the `/*` at `at` opens a block comment (see commentRanges). */
function opensBlock(source, at) {
  const lineStart = source.lastIndexOf("\n", at - 1) + 1;
  if (/^\s*$/.test(source.slice(lineStart, at)) || source[at - 1] === "{") return true;
  const lineEnd = source.indexOf("\n", at);
  const rest = source.slice(at + 2, lineEnd === -1 ? source.length : lineEnd);
  return rest.includes("*/") && !/[\w*/.\\]/.test(source[at - 1]);
}

// `<` is left out on purpose: `</Text>` is a closing tag, not a regex.
const REGEX_AFTER = /(?:^|[(,=:[!&|?{};+\-*%>~^]|\b(?:return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await))\s*$/;

/**
 * The index of the `/` closing a regex literal that opens at `at`, or null
 * when that `/` is division (judged by what precedes it) or no close follows
 * on the same line.
 */
function regexEnd(source, at) {
  const lineStart = source.lastIndexOf("\n", at - 1) + 1;
  let before = source.slice(lineStart, at);
  if (/^\s*$/.test(before) && lineStart > 0) {
    // First on its line: the line above decides (`(a + b)` then `/ 2` is
    // division), unless it is a comment line, whose last words say nothing.
    const above = source.slice(source.lastIndexOf("\n", lineStart - 2) + 1, lineStart - 1);
    before = /^\s*(?:\/\/|\*|\/\*)/.test(above) ? "" : above;
  }
  if (!REGEX_AFTER.test(before.slice(-12))) return null;
  let inClass = false;
  for (let i = at + 1; i < source.length; i += 1) {
    const char = source[i];
    if (char === "\n") return null;
    if (char === "\\") i += 1;
    else if (char === "[") inClass = true;
    else if (char === "]") inClass = false;
    else if (char === "/" && !inClass) return i;
  }
  return null;
}

function inRanges(ranges, index) {
  return ranges.some(([from, to]) => index >= from && index < to);
}

/**
 * Whether `index` sits in a comment that starts its line: the comment range
 * holding it opens at the line's first non-blank character (or right after a
 * leading `{`), or opened on an earlier line and this line continues it with
 * `*`. A comment that opens later on the line, after code, doesn't count.
 */
function inLineComment(ranges, source, index) {
  const range = ranges.find(([from, to]) => index >= from && index < to);
  if (!range) return false;
  const lineStart = source.lastIndexOf("\n", index - 1) + 1;
  const lead = source.slice(lineStart).match(/^\s*\{?/);
  const first = lineStart + lead[0].length;
  if (range[0] < lineStart) return /^\s*\*/.test(source.slice(lineStart, index));
  return range[0] === first;
}

/** Matches of `pattern` that count as copy: everything but a comment that starts its line. */
function copyMatches(files, pattern) {
  const found = [];
  for (const { rel, source } of files) {
    const comments = commentRanges(rel, source);
    for (const match of source.matchAll(pattern)) {
      if (!inLineComment(comments, source, match.index)) found.push({ rel, source, match });
    }
  }
  return found;
}

/** Matches of `pattern` outside every comment the scanner found: code for certain. */
function certainCodeMatches(files, pattern) {
  const found = [];
  for (const { rel, source } of files) {
    const comments = commentRanges(rel, source);
    for (const match of source.matchAll(pattern)) {
      if (!inRanges(comments, match.index)) found.push({ rel, source, match });
    }
  }
  return found;
}

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

/** `Signet` as a whole word anywhere but a comment that starts its line; `SignetTokens` is not a hit. */
export function signetCopyProblems(files) {
  return copyMatches(files, /\bSignet\b/g).map(
    ({ rel, source, match }) => `${rel}:${lineOf(source, match.index)}`,
  );
}

/** A Save-as name that still starts signet-. Design-system files are not downloads. */
export const SIGNET_DOWNLOAD_NAME = /\bsignet-[^\n]{0,80}?\.(?:ics|csv|pdf)\b/gi;

export function signetDownloadNameProblems(files) {
  return copyMatches(files, SIGNET_DOWNLOAD_NAME).map(
    ({ rel, source, match }) => `${rel}:${lineOf(source, match.index)}`,
  );
}

/**
 * Every `Settings → X` path in code, with X the word iOS Settings must list.
 * Only code outside every comment counts, so a misread can only drop a path,
 * which the floor then reports, never supply one.
 */
export function collectSettingsPaths(files) {
  return certainCodeMatches(files, /Settings → ([A-Za-z][\w-]*)/g).map(({ rel, source, match }) => ({
    rel,
    line: lineOf(source, match.index),
    name: match[1],
  }));
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

test("a comment opener inside a string, JSON or JSX text hides nothing", () => {
  const files = [
    { rel: "a.ts", source: 'const accept = "image/*";\nconst reason = "Signet needs your photos.";\n' },
    {
      rel: "b.json",
      source: '{ "assetBundlePatterns": ["**/*"], "infoPlist": { "X": "Signet reads it." } }\n',
    },
    { rel: "c.tsx", source: "<Text>\n  Help lives at https://frapp.live/help. Return to Signet.\n</Text>\n" },
    { rel: "d.ts", source: "const s = `line one\n see https://frapp.live and Signet`;\n" },
    { rel: "e.ts", source: 'const s = `${fn({ a: 1 })} Signet`;\n' },
    { rel: "f.tsx", source: "<Text>Don't</Text>\n// Signet gold\nconst t = \"Signet\";\n" },
  ];
  assert.deepEqual(signetCopyProblems(files), [
    "a.ts:2",
    "b.json:1",
    "c.tsx:2",
    "d.ts:2",
    "e.ts:1",
    "f.tsx:3",
  ]);
});

test("a regex literal opens no comment, template or string", () => {
  const files = [
    { rel: "a.ts", source: 'const clean = url.replace(/\\/*$/, "");\nconst r = "Signet needs your photos.";\n/** doc */\n' },
    { rel: "b.ts", source: 'const glob = /[/*]/;\nconst r = "Signet";\n/** doc */\n' },
    { rel: "c.ts", source: 'const re = /`/;\nconst a = `image/*`;\nconst t = "Signet";\n' },
    { rel: "d.ts", source: 'const ok = /^https?:\\/\\//.test(u) ? "Signet" : "x";\n' },
    { rel: "e.ts", source: 's.replace(/`/g, "");\nconst label = `${n} // Signet ${m}`;\n' },
    { rel: "f.ts", source: 'const a = `${s.replace(/{/g, "")} done`;\nconst t = "Signet";\n' },
    { rel: "g.ts", source: 'const t = x.replace(\n  // drop inline-code ticks\n  /`/g,\n  "",\n);\n// Signet gold ring\n' },
    { rel: "i.ts", source: 'const re = /`/;\nconst g = `**/*.ts`;\nconst t = "Signet";\n' },
    { rel: "j.ts", source: 'const a = `${s.replace(/{/g, "")}`;\nconst b = `a/*b`;\nconst t = "Signet";\n' },
  ];
  assert.deepEqual(signetCopyProblems(files), [
    "a.ts:2",
    "b.ts:2",
    "c.ts:3",
    "d.ts:1",
    "e.ts:2",
    "f.ts:2",
    "i.ts:3",
    "j.ts:3",
  ]);
});

test("a miscounted quote can't open a comment over the lines below", () => {
  // A raw apostrophe in JSX text (lint refuses it, but a lock can't lean on
  // lint) pairs with the quote before image/, so the glob's `/*` is read as
  // code. It follows a word character, so it opens no comment, and the lines
  // below stay code even when they carry a URL.
  const source = [
    "<Text>Don't worry</Text><Picker accept={'image/*'} />",
    "<Text>Return to Signet.</Text>",
    '<Link href="https://frapp.live">Open Settings → Signet</Link>',
    "",
  ].join("\n");
  const backtick = "<Text>Press ` then</Text>\nconst g = `**/*.ts`;\n<Text>See https://frapp.live, Signet</Text>\n";
  assert.deepEqual(signetCopyProblems([{ rel: "b.tsx", source: backtick }]), ["b.tsx:3"]);
  assert.deepEqual(signetCopyProblems([{ rel: "a.tsx", source }]), ["a.tsx:2", "a.tsx:3"]);
  assert.deepEqual(settingsPathProblems([{ rel: "a.tsx", source }], "Frapp"), [
    "must keep at least 2 Settings → Frapp paths",
    "a.tsx:3 names Settings → Signet, not Frapp",
  ]);
});

test("a misread `/*` can't hide the lines below it", () => {
  const files = [
    { rel: "a.tsx", source: "<Text>\n  Files /* here\n  Return to Signet.\n</Text>\n" },
    { rel: "b.tsx", source: "<Text>Use and/or /* here</Text>\n<Text>Settings → Signet</Text>\n/** doc */\n" },
    { rel: "c.tsx", source: "<Text>{a}/*{b}</Text>\n<Text>Signet</Text>\n{/* x */}\n" },
    {
      rel: "d.tsx",
      source: "<Text>Press ` then</Text>\nconst g = `Files /* all`;\n<Text>Return to Signet.</Text>\n/** doc */\n",
    },
    { rel: "e.ts", source: 'const accept = x//TODO: restore /* glob\nexport const r = "Signet";\n/** doc */\n' },
    { rel: "f.ts", source: 'const n = x//count of `items\nconst label = `${n} // total`; const t = "Signet";\n' },
  ];
  assert.deepEqual(signetCopyProblems(files), ["a.tsx:3", "b.tsx:2", "c.tsx:2", "d.tsx:3", "e.ts:2", "f.ts:2"]);
});

test("a misread `/*` or backtick can't hide copy on a line that isn't a comment line", () => {
  const files = [
    { rel: "a.tsx", source: "<Text>\n  Upload files matching\n  /* or pick one\n</Text>\n<Text>Return to Signet.</Text>\n" },
    { rel: "b.tsx", source: "<Text>Press ` then</Text>\nconst css = `\n  /* all\n`;\n<Text>Return to Signet.</Text>\n" },
    { rel: "c.tsx", source: "<Text>and//or</Text>{`x\n  /* y\n`}\n<Text>Signet</Text>\n" },
    { rel: "d.tsx", source: "const re = [\n  // backtick\n  /`/,\n];\nconst css = `\n  /* all\n`;\n<Text>Signet</Text>\n" },
  ];
  assert.deepEqual(signetCopyProblems(files), ["a.tsx:5", "b.tsx:5", "c.tsx:4", "d.tsx:8"]);
});

test("a comment that opens after code on a line exempts nothing after a misread", () => {
  const files = [
    { rel: "a.tsx", source: "<Text>\n  {/* keep on one line */}Tap and//or hold to open Signet.\n</Text>\n" },
    { rel: "b.tsx", source: "/* x */ <Text>Type // to reply in Signet</Text>\n" },
  ];
  assert.deepEqual(signetCopyProblems(files), ["a.tsx:2", "b.tsx:1"]);
});

test("a Settings path in a comment is no recovery path, either way", () => {
  const code = (rel, text) => ({ rel, source: `const reason = "${text}";\n` });
  const study = code("study.tsx", "Turn it on in Settings → Frapp → Location.");
  const primer = code("primer.tsx", "Turn it on in Settings → Frapp → Location.");
  const noted = [
    study,
    primer,
    { rel: "c.tsx", source: "Linking.openSettings(); // iOS: Settings → Privacy → Location\n" },
    { rel: "d.tsx", source: "{/* Undo lives in\n    Settings → Blocked members. */}\n" },
  ];
  assert.deepEqual(settingsPathProblems(noted, "Frapp"), []);
  const dropped = [study, { rel: "e.tsx", source: "Linking.openSettings(); // lands on Settings → Frapp\n" }];
  assert.deepEqual(settingsPathProblems(dropped, "Frapp"), ["must keep at least 2 Settings → Frapp paths"]);
});

test("a `/` first on its line after code divides, after a comment it starts a regex", () => {
  const files = [
    { rel: "a.ts", source: "const x = (a + b)\n  / 2 + `${c}/d`;\n// Signet gold\n" },
    { rel: "b.ts", source: 'const t = x.replace(\n  // drop inline-code ticks\n  /`/g,\n  "",\n);\n// Signet gold ring\n' },
  ];
  assert.deepEqual(signetCopyProblems(files), []);
});

test("a design-system note names Signet only on a comment line", () => {
  const allowed = [
    { rel: "a.ts", source: "// Signet gold\n" },
    { rel: "b.ts", source: "/**\n * Signet is dark-only.\n */\n" },
    { rel: "c.tsx", source: "{/* Signet gold, never the chapter accent */}\n" },
    { rel: "d.ts", source: "/* Signet tokens */\n" },
  ];
  assert.deepEqual(signetCopyProblems(allowed), []);
  // After code, or on a comment's star-less continuation line, it reports:
  // the rule fails closed rather than trust the scanner there.
  const reported = [
    { rel: "a.ts", source: "x; // Signet gold\n" },
    { rel: "b.ts", source: "foo(); /* Signet gold */ bar();\n" },
    { rel: "c.tsx", source: "{/* The\n    Signet gold ring */}\n" },
  ];
  assert.deepEqual(signetCopyProblems(reported), ["a.ts:1", "b.ts:1", "c.tsx:2"]);
});

test("design-system names and comments are not copy", () => {
  const files = [
    { rel: "a.ts", source: 'import { SignetTokens } from "@repo/theme/signet";\n' },
    { rel: "b.ts", source: "// Signet gold, never the chapter accent.\n" },
    { rel: "c.ts", source: "/**\n * Signet is dark-only by design.\n */\n" },
    { rel: "d.tsx", source: "{/* Static: Signet is dark-only,\n   so no toggle. */}\n" },
    { rel: "e.ts", source: 'const url = "https://frapp.live";\n// Signet tokens below\n' },
    { rel: "f.ts", source: 'const s = `${"}"} b`;\n// Signet gold\n' },
    { rel: "g.tsx", source: "<Text>a</Text>\n{/* Signet gold */}\n" },
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
