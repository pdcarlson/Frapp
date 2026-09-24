// Locks what the web dashboard says to a person on Frapp, never Signet.
//
// WHY THIS EXISTS. ADR-25 names the product Frapp, and step 4 moved the web
// dashboard off "Signet": the tab titles, the auth wordmark, onboarding,
// settings and roles copy, the Discord import screens, the invite share
// text, and the CSV and ICS download names, plus the @repo/hooks and
// @repo/validation strings the dashboard renders. The tab titles, the auth
// wordmark and the ops-nudge headlines keep their own locks
// (frapp-web-titles, frapp-auth-wordmark, frapp-ops-nudge-copy). The walk
// here is what makes those pinned sites not the whole story: a new screen
// that says Signet fails without anyone listing it.
//
// WHAT IT CHECKS.
// - A walk of apps/web's non-spec sources, and of every packages/*/src (the
//   dashboard renders copy from @repo/hooks, @repo/validation, @repo/chat-core,
//   @repo/org-archetypes and more, and a package added later is walked without
//   anyone listing it): no whole word "Signet" and no signet- download
//   filename outside the comment a line starts with (the note on LINE_BREAK
//   in ../lib/copy-lines.mjs says why, and names the one blind spot). A
//   design-system note that names Signet goes on its own comment line, not
//   after code or inside a JSX comment's star-less continuation. Nothing
//   passes: unlike the API, the dashboard ships no design-system phrase.
// - The CSV download template, the empty-title .ics fallback and the invite
//   share header, pinned by value. A rename that dropped the brand
//   altogether would pass the walk. Only the CSV name also has a unit spec
//   (apps/web/lib/utils.spec.ts), so for the other two this pin is the only
//   check. This replaces the web half of signet-calendar-prodid and all of
//   signet-export-filenames, which pinned the same sites on Signet until
//   step 4.
//
// SCOPE. apps/web and the shared packages' sources. apps/web/tests
// holds test fixtures, not shipped code, and is skipped with the specs.
// Identifiers are not copy and stay: the `--signet-*` tokens, `SignetMark`,
// `signet-emblem-B.png`, `@repo/theme/signet.css` and the `signet-accent-cache`
// style id. Landing renames in step 5 and has its own lock
// (signet-landing-copy). The @frapp.live ICS UID host is ics-uid-host's.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { copyMatches, SIGNET_DOWNLOAD_NAME } from "../lib/copy-lines.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const LOCK = fileURLToPath(import.meta.url);

/** Where the walk starts. Every package's `src` joins it; see liveFiles. */
const WALK_ROOTS = ["apps/web"];
const PACKAGES_ROOT = "packages";
const SKIP_DIRS = new Set(["node_modules", "dist", ".next", ".turbo", "coverage", "tests"]);
const SOURCE_EXT = /\.(?:json|js|mjs|ts|tsx)$/;

const CSV_UTILS = "apps/web/lib/utils.ts";
const EVENT_SHEET = "apps/web/components/events/event-detail-sheet.tsx";
const INVITE_DIALOG = "apps/web/components/members/invite-member-dialog.tsx";

export const PINNED_SITES = [
  { rel: CSV_UTILS, wanted: "`frapp-${filenamePrefix}-" },
  { rel: EVENT_SHEET, wanted: '|| "frapp-event"' },
  { rel: INVITE_DIALOG, wanted: '"Frapp member invite",' },
];

function readRepo(rel) {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

function relOf(path) {
  return relative(REPO_ROOT, path).replaceAll("\\", "/");
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
    if (!entry.isFile() || !SOURCE_EXT.test(entry.name)) continue;
    if (/\.(?:spec|test)\./.test(entry.name)) continue;
    out.push(path);
  }
  return out;
}

/** Each `packages/<name>/src`; a package's manifest and assets are not copy. */
function packageSources() {
  return readdirSync(join(REPO_ROOT, PACKAGES_ROOT), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(REPO_ROOT, PACKAGES_ROOT, entry.name, "src")))
    .map((entry) => `${PACKAGES_ROOT}/${entry.name}/src`);
}

function liveFiles() {
  return [...WALK_ROOTS, ...packageSources()].flatMap((root) => walk(join(REPO_ROOT, root))).map((path) => ({
    rel: relOf(path),
    source: readFileSync(path, "utf8"),
  }));
}

/** `Signet` as a whole word; `SignetMark` and `--signet-*` are not hits. */
export function signetCopyProblems(files) {
  return copyMatches(files, /\bSignet\b/g).map(({ rel, line }) => `${rel}:${line}`);
}

export function signetDownloadNameProblems(files) {
  return copyMatches(files, SIGNET_DOWNLOAD_NAME).map(({ rel, line }) => `${rel}:${line}`);
}

export function pinnedSiteProblems(read = readRepo) {
  return PINNED_SITES.filter(({ rel, wanted }) => !read(rel).includes(wanted)).map(
    ({ rel, wanted }) => `${rel} must ship ${wanted}`,
  );
}

export function lockSelfProblems(source) {
  const problems = [];
  const roots = source.match(/^const WALK_ROOTS = \[([^\]]*)\];$/m);
  const listed = roots ? [...roots[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]) : [];
  if (!listed.includes("apps/web")) problems.push("the walk must start at apps/web");
  if (!/^const PACKAGES_ROOT = "packages";$/m.test(source)) {
    problems.push("the walk must cover every packages/*/src");
  }
  if (listed.some((root) => root.startsWith("apps/landing"))) {
    problems.push("must not walk apps/landing (step 5 has its own lock)");
  }
  return problems;
}

test("the web dashboard says Frapp, never Signet", () => {
  const files = liveFiles();
  for (const rel of [
    "apps/web/app/layout.tsx",
    "apps/web/components/discord-import/connect-step.tsx",
    "packages/hooks/src/use-discord-connection.ts",
    "packages/validation/src/ops-nudges.ts",
    "packages/chat-core/src/index.ts",
    "packages/org-archetypes/src/index.ts",
  ]) {
    assert.ok(files.some((file) => file.rel === rel), `walk must reach ${rel}`);
  }
  assert.ok(
    !files.some((file) => file.rel.startsWith("apps/web/tests/")),
    "apps/web/tests holds fixtures, not shipped copy",
  );
  assert.deepEqual(signetCopyProblems(files), []);
  assert.deepEqual(signetDownloadNameProblems(files), []);
  assert.deepEqual(pinnedSiteProblems(), []);
  assert.deepEqual(lockSelfProblems(readFileSync(LOCK, "utf8")), []);
});

test("a Signet string fails the walk wherever it is copy", () => {
  const problems = signetCopyProblems([
    {
      rel: "apps/web/components/discord-import/connect-step.tsx",
      source: "<p>\n  Add the Signet bot to your Discord server.\n</p>\n",
    },
    {
      rel: "packages/hooks/src/use-discord-connection.ts",
      source: 'message: "Discord connected. Signet can now read your server\'s history.",\n',
    },
    {
      rel: "apps/web/components/settings/settings-page.tsx",
      source: "{/*\n  A note, but its second line has no star: Signet counts.\n*/}\n",
    },
  ]);
  assert.deepEqual(problems, [
    "apps/web/components/discord-import/connect-step.tsx:2",
    "packages/hooks/src/use-discord-connection.ts:1",
    "apps/web/components/settings/settings-page.tsx:2",
  ]);
});

test("identifiers and leading comments that name the design system pass", () => {
  assert.deepEqual(
    signetCopyProblems([
      {
        rel: "apps/web/components/auth/signet-mark.tsx",
        source: [
          "/**",
          " * The Signet mark: locked emblem B.",
          " */",
          'import { SignetMark } from "./signet-mark";',
          'src="/brand/signet-emblem-B.png"',
          "// Signet is dark-only.",
          'className="bg-[var(--signet-gold)]"',
        ].join("\n"),
      },
    ]),
    [],
  );
  assert.deepEqual(
    signetDownloadNameProblems([
      { rel: "apps/web/components/shared/crest-page.tsx", source: 'src="/brand/signet-emblem-B.png"\n' },
    ]),
    [],
  );
});

test("a signet- CSV or ICS download name fails the walk", () => {
  assert.deepEqual(
    signetDownloadNameProblems([
      {
        rel: CSV_UTILS,
        source: "downloadBlob(blob, `signet-${filenamePrefix}-${day}.csv`);\n",
      },
      {
        rel: EVENT_SHEET,
        source: '.replace(/^-+|-+$/g, "") || "signet-event";\ndownloadBlob(icsBlob, `${slug}.ics`);\n',
      },
    ]),
    [`${CSV_UTILS}:1`],
  );
  // The fallback's `.ics` is on the next line, so the walk can't see it: that
  // is why the fallback is pinned by value too.
  const reverted = (rel) =>
    readRepo(rel)
      .replace("`frapp-${filenamePrefix}-", "`signet-${filenamePrefix}-")
      .replace('|| "frapp-event"', '|| "signet-event"')
      .replace('"Frapp member invite",', '"Signet member invite",');
  assert.deepEqual(pinnedSiteProblems(reverted), PINNED_SITES.map(({ rel, wanted }) => `${rel} must ship ${wanted}`));
});

test("dropping the brand from a pinned site fails the pin", () => {
  const dropped = (rel) =>
    readRepo(rel).replace("`frapp-${filenamePrefix}-", "`${filenamePrefix}-");
  assert.deepEqual(pinnedSiteProblems(dropped), [`${CSV_UTILS} must ship ${PINNED_SITES[0].wanted}`]);
});

test("the walk can't drop a root or move onto landing", () => {
  const lock = readFileSync(LOCK, "utf8");
  assert.deepEqual(
    lockSelfProblems(lock.replace('const WALK_ROOTS = ["apps/web"];', "const WALK_ROOTS = [];")),
    ["the walk must start at apps/web"],
  );
  assert.deepEqual(
    lockSelfProblems(lock.replace('const PACKAGES_ROOT = "packages";', 'const PACKAGES_ROOT = "packages/hooks";')),
    ["the walk must cover every packages/*/src"],
  );
  assert.deepEqual(
    lockSelfProblems(lock.replace('const WALK_ROOTS = ["apps/web"];', 'const WALK_ROOTS = ["apps/web", "apps/landing"];')),
    ["must not walk apps/landing (step 5 has its own lock)"],
  );
});

test("refuses a GitHub closer next to an issue number", () => {
  const lock = readFileSync(LOCK, "utf8");
  assert.doesNotMatch(
    lock,
    /\b(fixes|closes|close|fix|fixed|resolve|resolves|resolved)\s+#/i,
  );
});
