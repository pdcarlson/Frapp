// Locks the landing site's copy and identity on Frapp.
//
// WHY THIS EXISTS. ADR-25 names the product Frapp, and step 5 moved the
// landing and the legal pages off Signet: the metadata, the OG card, the
// JSON-LD, the hero and footer copy, the lockup wordmark and the Privacy,
// FERPA and Support bodies. This lock was signet-landing-copy, which held
// all of that on Signet; it flipped with them. A leftover sweep can put the
// old name back in any of those strings, switch a title to single quotes the
// walker used to miss, drop the floor so a deleted title passes, or add a
// route whose `<head>` falls back to the homepage's.
//
// SCOPE. Every .ts/.tsx source under apps/landing outside the specs:
// `Signet` as a whole word in anything but a line's leading comment is a
// hit (the rule is scripts/ci/__tests__/helpers/copy-lines.mjs). Identifiers are not copy
// and stay until the internals series: `SignetCrest`, `SIGNET_CREST_PATH`,
// `signet-crest.tsx`, `signet-emblem-B.png` and the `--signet-*` tokens.
// On top of the walk, the sites a crawler or a social preview reads are
// pinned by value. Do not walk apps/web: frapp-web-titles and frapp-web-copy
// lock it. This lock is about COPY and identity, not visuals: do not turn it
// into a token check.
//
// EVERY ROUTE NAMES ITSELF. `/terms`, `/privacy` and `/ferpa` had no
// `metadata` export, so crawlers read each as the homepage, and `/privacy`
// is the page app review reads. Each legal route, `/support` included, now
// builds its metadata with `routeMetadata` (apps/landing/lib/route-metadata.ts)
// from its own "<Page> · Frapp" title and its path. A route that set only
// `title` would still inherit the root layout's `openGraph` and `twitter`
// objects (Next merges metadata by top-level key), so a shared link would
// preview as the homepage; the helper restates both with the route's title and
// `og:url`. The floor counts every title: the layout's 3 + one per route.
//
// THE STATUS BANNER TRACKS THE RESKIN, SO IT MOVES. The landing spec must
// always announce its own status at the top, so a change to that status
// has to come here and say so rather than letting the doc go quiet. Retire
// the banner when the reskin's owner decisions close, and delete this
// assertion in the same change rather than loosening it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { copyMatches } from "./helpers/copy-lines.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const LOCK = fileURLToPath(import.meta.url);
const LANDING = join(REPO_ROOT, "apps/landing");

const LAYOUT = "apps/landing/app/layout.tsx";
const OG_IMAGE = "apps/landing/app/opengraph-image.tsx";
const HOME = "apps/landing/app/page.tsx";
const LOCKUP = "apps/landing/components/frapp-lockup.tsx";
const SPEC = "spec/ui/landing/README.md";
const ROUTE_METADATA = "apps/landing/lib/route-metadata.ts";

const HOME_TITLE = "Frapp. Ask your chapter anything.";

/** Each route's own title. A route missing here inherits the homepage `<head>`. */
export const ROUTE_TITLES = {
  "apps/landing/app/support/page.tsx": "Support · Frapp",
  "apps/landing/app/terms/page.tsx": "Terms of Service · Frapp",
  "apps/landing/app/privacy/page.tsx": "Privacy Policy · Frapp",
  "apps/landing/app/ferpa/page.tsx": "FERPA Notice · Frapp",
};

/** Root + OG + Twitter on the layout, and /support, /terms, /privacy, /ferpa. Deleting a title must fail. */
const MIN_METADATA_TITLES = 7;

const SKIP_DIRS = new Set(["node_modules", "dist", ".next", ".turbo", "coverage", "public"]);
const SOURCE_EXT = /\.(?:ts|tsx)$/;

function readRepo(rel) {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    if (/\.(?:spec|test)\./.test(entry.name) || entry.name.endsWith(".d.ts")) continue;
    out.push(path);
  }
  return out;
}

function liveFiles() {
  return walk(LANDING).map((path) => ({
    rel: relative(REPO_ROOT, path).replaceAll("\\", "/"),
    source: readFileSync(path, "utf8"),
  }));
}

/** `Signet` as a whole word outside a leading comment; `SignetCrest` is not a hit. */
export function signetCopyProblems(files) {
  return copyMatches(files, /\bSignet\b/g).map(({ rel, line }) => `${rel}:${line}`);
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

export function metadataTitleProblems(files) {
  const problems = [];
  let found = 0;
  for (const { rel, source } of files) {
    for (const title of collectMetadataTitles(source)) {
      found += 1;
      if (!/Frapp/.test(title)) problems.push(`${rel}:missing-frapp`);
      if (/Signet/.test(title)) problems.push(`${rel}:signet`);
    }
  }
  if (found < MIN_METADATA_TITLES) {
    problems.push("landing must keep the Frapp metadata titles");
  }
  return problems;
}

export function pinnedTitleProblems({ layout, routes }) {
  const problems = [];
  const homeHits = [...layout.matchAll(new RegExp(`title: ["']${escape(HOME_TITLE)}["']`, "g"))];
  if (homeHits.length !== 3) {
    problems.push("layout metadata / OG / Twitter titles");
  }
  for (const [rel, title] of Object.entries(ROUTE_TITLES)) {
    const source = routes[rel] ?? "";
    const pinned =
      isMetadataFile(source) &&
      /export const metadata: Metadata = routeMetadata\(\{/.test(source) &&
      new RegExp(`title: ["']${escape(title)}["']`).test(source);
    if (!pinned) {
      problems.push(`${rel} metadata title`);
    }
    const path = `/${rel.split("/").at(-2)}`;
    if (!new RegExp(`path: ["']${escape(path)}["']`).test(source)) {
      problems.push(`${rel} path must be ${path}`);
    }
  }
  return problems;
}

export function ogCardProblems(og) {
  const problems = [];
  if (!new RegExp(`^export const alt = ["']${escape(HOME_TITLE)}["'];$`, "m").test(og)) {
    problems.push("OG alt text");
  }
  // The wordmark drawn into the card is JSX text on a line of its own.
  if (!/^\s*Frapp\s*$/m.test(og)) {
    problems.push("OG wordmark must read Frapp");
  }
  return problems;
}

/** The helper must restate the social blocks, or a route inherits the homepage's. */
export function routeHelperProblems(helper) {
  const problems = [];
  const og = /openGraph: \{([\s\S]*?)\n    \},/.exec(helper);
  if (!og || !/\btitle,/.test(og[1]) || !/url: path,/.test(og[1]) || !/images: \[SHARE_IMAGE\]/.test(og[1])) {
    problems.push("routeMetadata must set openGraph title, url and image");
  }
  const tw = /twitter: \{([\s\S]*?)\n    \},/.exec(helper);
  if (!tw || !/\btitle,/.test(tw[1]) || !/card: "summary_large_image"/.test(tw[1])) {
    problems.push("routeMetadata must set the Twitter card and title");
  }
  if (!new RegExp(`alt: ["']${escape(HOME_TITLE)}["']`).test(helper)) {
    problems.push("routeMetadata's share image alt");
  }
  return problems;
}

export function jsonLdNames(source) {
  return [...source.matchAll(/name:\s*(["'])([^"']+)\1/g)].map((match) => match[2]);
}

export function jsonLdProblems(home) {
  const names = jsonLdNames(home);
  const problems = [];
  if (names.filter((name) => name === "Frapp").length !== 2) {
    problems.push("application + brand must both be Frapp");
  }
  if (names.includes("Signet")) {
    problems.push("JSON-LD must not name Signet");
  }
  return problems;
}

export function chromeSurfaceProblems({ lockup, spec }) {
  const problems = [];
  // Owner, 2026-09-28: the header crest sits on the page background with no
  // tile (spec/ui/assets.md §3). The component draws nothing with a fill.
  if (/\bbg-/.test(lockup)) {
    problems.push("lockup must draw the crest with no tile behind it");
  }
  if (!/aria-label=["']Frapp["']/.test(lockup)) {
    problems.push("lockup aria-label must be Frapp");
  }
  if (!/>Frapp<\/span>/.test(lockup)) {
    problems.push("lockup wordmark must read Frapp");
  }
  if (!/> \*\*RESKIN BUILT OUT\*\*/.test(spec)) {
    problems.push("spec must keep the reskin-built-out banner");
  }
  return problems;
}

export function lockSelfProblems(source) {
  const problems = [];
  const floor = source.match(/^const MIN_METADATA_TITLES = (\d+);?$/m);
  if (!floor || floor[1] !== "7") {
    problems.push("MIN_METADATA_TITLES must stay 7");
  }
  const landing = source.match(/^const LANDING = join\(REPO_ROOT, "([^"]+)"\);?$/m);
  if (!landing || landing[1] !== "apps/landing") {
    problems.push("walker must stay on apps/landing");
  }
  if (landing && landing[1].startsWith("apps/web")) {
    problems.push("must not walk apps/web");
  }
  if (!/title:\\s\*\(\["'\]/.test(source)) {
    problems.push("must collect single-quoted and double-quoted titles");
  }
  return problems;
}

/** Routes that render no `<head>` of their own: the homepage owns the root one, and /join only redirects. */
export const NO_METADATA_ROUTES = new Set(["apps/landing/app/page.tsx", "apps/landing/app/join/page.tsx"]);

/** Every other `page.tsx` needs its own metadata, and a pinned title. */
export function routeCoverageProblems(files) {
  const problems = [];
  for (const { rel, source } of files) {
    if (!rel.endsWith("/page.tsx") || NO_METADATA_ROUTES.has(rel)) continue;
    if (!isMetadataFile(source)) problems.push(`${rel} has no metadata export`);
    if (!(rel in ROUTE_TITLES)) problems.push(`${rel} has no pinned title in ROUTE_TITLES`);
  }
  return problems;
}

function routeSources() {
  return Object.fromEntries(Object.keys(ROUTE_TITLES).map((rel) => [rel, readRepo(rel)]));
}

test("the landing site says Frapp, never Signet", () => {
  const files = liveFiles();
  for (const rel of [LAYOUT, OG_IMAGE, HOME, LOCKUP, ...Object.keys(ROUTE_TITLES)]) {
    assert.ok(
      files.some((file) => file.rel === rel),
      `${rel} left the walk`,
    );
  }
  assert.deepEqual(signetCopyProblems(files), []);
});

test("landing metadata titles say Frapp, one per route", () => {
  assert.deepEqual(metadataTitleProblems(liveFiles()), []);
  assert.deepEqual(pinnedTitleProblems({ layout: readRepo(LAYOUT), routes: routeSources() }), []);
  assert.deepEqual(routeHelperProblems(readRepo(ROUTE_METADATA)), []);
});

test("a helper that stops restating the social blocks fails", () => {
  const helper = readRepo(ROUTE_METADATA);
  assert.deepEqual(routeHelperProblems(helper.replace("      url: path,\n", "")), [
    "routeMetadata must set openGraph title, url and image",
  ]);
  assert.deepEqual(routeHelperProblems(helper.replace('      card: "summary_large_image",\n', "")), [
    "routeMetadata must set the Twitter card and title",
  ]);
});

test("every route but the homepage and /join names itself", () => {
  assert.deepEqual(routeCoverageProblems(liveFiles()), []);
});

test("a new route without metadata fails", () => {
  const rel = "apps/landing/app/accessibility/page.tsx";
  const source = "export default function A() { return null; }\n";
  assert.deepEqual(routeCoverageProblems([{ rel, source }]), [
    `${rel} has no metadata export`,
    `${rel} has no pinned title in ROUTE_TITLES`,
  ]);
});

test("the OG card's alt text and wordmark say Frapp", () => {
  assert.deepEqual(ogCardProblems(readRepo(OG_IMAGE)), []);
});

test("JSON-LD application and brand names are Frapp", () => {
  assert.deepEqual(jsonLdProblems(readRepo(HOME)), []);
});

test("the lockup says Frapp and the spec keeps its status banner", () => {
  assert.deepEqual(chromeSurfaceProblems({ lockup: readRepo(LOCKUP), spec: readRepo(SPEC) }), []);
});

test("Signet in the hero, the footer or a legal body fails the walk", () => {
  const home = readRepo(HOME).replace("Frapp is chat first. Events", "Signet is chat first. Events");
  assert.deepEqual(signetCopyProblems([{ rel: HOME, source: home }]).length, 1);
  const footer = readRepo(HOME).replace("getFullYear()} Frapp", "getFullYear()} Signet");
  assert.deepEqual(signetCopyProblems([{ rel: HOME, source: footer }]).length, 1);
  const privacy = "apps/landing/app/privacy/page.tsx";
  const body = readRepo(privacy).replace("Frapp collects account", "Signet collects account");
  assert.deepEqual(signetCopyProblems([{ rel: privacy, source: body }]).length, 1);
});

test("identifiers and leading comments are not copy", () => {
  const source = [
    'import { SignetCrest } from "../components/signet-crest";',
    "// The Signet ladder.",
    " * Signet is the design system's name.",
    '<SignetCrest className="h-8 w-8" />',
    "fill={SIGNET_CREST_GOLD}",
  ].join("\n");
  assert.deepEqual(signetCopyProblems([{ rel: "x.tsx", source }]), []);
  // A comment after code is not a leading comment, so it reports.
  assert.deepEqual(signetCopyProblems([{ rel: "x.tsx", source: 'color: "#131211", // the Signet stage' }]), [
    "x.tsx:1",
  ]);
});

test("putting Signet back in a layout metadata title fails", () => {
  const problems = metadataTitleProblems([
    { rel: LAYOUT, source: readRepo(LAYOUT).replaceAll(HOME_TITLE, "Signet. Ask your chapter anything.") },
    ...Object.entries(routeSources()).map(([rel, source]) => ({ rel, source })),
  ]);
  assert.ok(problems.includes(`${LAYOUT}:signet`), problems.join("; "));
  assert.ok(problems.includes(`${LAYOUT}:missing-frapp`), problems.join("; "));
});

test("dropping a route's metadata fails the floor and the pin", () => {
  const privacy = "apps/landing/app/privacy/page.tsx";
  const routes = routeSources();
  routes[privacy] = routes[privacy].replace(/export const metadata[\s\S]*?\n\}\);\n/, "");
  const problems = metadataTitleProblems([
    { rel: LAYOUT, source: readRepo(LAYOUT) },
    ...Object.entries(routes).map(([rel, source]) => ({ rel, source })),
  ]);
  assert.ok(problems.includes("landing must keep the Frapp metadata titles"), problems.join("; "));
  assert.deepEqual(pinnedTitleProblems({ layout: readRepo(LAYOUT), routes }), [
    `${privacy} metadata title`,
    `${privacy} path must be /privacy`,
  ]);
});

test("a route that sets its title without the helper fails the pin", () => {
  const privacy = "apps/landing/app/privacy/page.tsx";
  const routes = routeSources();
  routes[privacy] = routes[privacy].replace(
    "export const metadata: Metadata = routeMetadata({",
    "export const metadata: Metadata = ({",
  );
  assert.deepEqual(pinnedTitleProblems({ layout: readRepo(LAYOUT), routes }), [`${privacy} metadata title`]);
});

test("a single-quoted Signet title is collected", () => {
  const rel = "apps/landing/app/privacy/page.tsx";
  const source = "export const metadata = {\n  title: 'Signet — Privacy',\n};\n";
  assert.deepEqual(collectMetadataTitles(source), ["Signet — Privacy"]);
  assert.deepEqual(metadataTitleProblems([{ rel, source }]), [
    `${rel}:missing-frapp`,
    `${rel}:signet`,
    "landing must keep the Frapp metadata titles",
  ]);
});

test("Signet on the OG card fails", () => {
  const og = readRepo(OG_IMAGE);
  assert.deepEqual(ogCardProblems(og.replace(/^(\s*)Frapp$/m, "$1Signet")), ["OG wordmark must read Frapp"]);
  assert.deepEqual(ogCardProblems(og.replace(`alt = "${HOME_TITLE}"`, 'alt = "Signet"')), ["OG alt text"]);
});

test("Signet in JSON-LD fails", () => {
  const problems = jsonLdProblems(readRepo(HOME).replace('name: "Frapp"', 'name: "Signet"'));
  assert.deepEqual(problems, ["application + brand must both be Frapp", "JSON-LD must not name Signet"]);
});

test("the old lockup word or aria-label fails", () => {
  const spec = readRepo(SPEC);
  const lockup = readRepo(LOCKUP);
  assert.deepEqual(chromeSurfaceProblems({ lockup: lockup.replace('aria-label="Frapp"', 'aria-label="Signet"'), spec }), [
    "lockup aria-label must be Frapp",
  ]);
  assert.deepEqual(chromeSurfaceProblems({ lockup: lockup.replace(">Frapp</span>", ">Signet</span>"), spec }), [
    "lockup wordmark must read Frapp",
  ]);
  const tiled = lockup.replace(
    '<SignetCrest className="h-7 w-7" />',
    '<span className="rounded-xs bg-surface-1"><SignetCrest className="h-6 w-6" /></span>',
  );
  assert.notEqual(tiled, lockup);
  assert.deepEqual(chromeSurfaceProblems({ lockup: tiled, spec }), [
    "lockup must draw the crest with no tile behind it",
  ]);
});

test("dropping the status banner fails", () => {
  const problems = chromeSurfaceProblems({
    lockup: readRepo(LOCKUP),
    spec: readRepo(SPEC).replace("> **RESKIN BUILT OUT**", "> **DONE.**"),
  });
  assert.deepEqual(problems, ["spec must keep the reskin-built-out banner"]);
});

test("walker stays on landing and keeps the floor", () => {
  assert.deepEqual(lockSelfProblems(readFileSync(LOCK, "utf8")), []);
});

test("pointing the walker at web fails", () => {
  const problems = lockSelfProblems(
    readFileSync(LOCK, "utf8").replace(
      'const LANDING = join(REPO_ROOT, "apps/landing")',
      'const LANDING = join(REPO_ROOT, "apps/web")',
    ),
  );
  assert.ok(
    problems.some((problem) => problem.includes("apps/web")),
    problems.join("; "),
  );
});

test("dropping MIN_METADATA_TITLES below 7 fails", () => {
  const problems = lockSelfProblems(
    readFileSync(LOCK, "utf8").replace("const MIN_METADATA_TITLES = 7", "const MIN_METADATA_TITLES = 4"),
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
