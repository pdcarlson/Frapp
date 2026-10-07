// Locks the finished ADR-25 rename: every surface a person reads says Frapp,
// and "Signet" is left naming only the design system.
//
// WHY THIS EXISTS. ADR-25 moved the product name off Signet one surface at a
// time: mobile in step 2, the API and Auth in step 3, the web dashboard in
// step 4 and the landing and legal pages in step 5. Each step left a lock
// behind, thirteen files in all, and this table replaces them (#3225). A
// leftover sweep, a copy-paste revert or a stale `openapi:export` can put the
// old name back on any of them without a unit spec noticing, and a shipped
// mobile binary keeps a bad string until its user updates from the store.
//
// HOW TO READ IT. Six tables, each checked by one loop:
// - COPY_WALKS: every copy line under a surface's roots (the rule is
//   ./helpers/copy-lines.mjs, which ignores only the comment a line starts with)
//   must not say Signet or ship a signet- download name. The walks are what
//   make the pins below not the whole story: a new screen that says Signet
//   fails without anyone listing it.
// - TEXT_BANS: whole-file bans, comments included, for strings that are never
//   a design-system note.
// - SITE_ROSTERS: the exact set of files that hold a kind of copy. A second
//   copy of a pinned site, or a site moved away from its pin, fails.
// - COLLECTED: values pulled out of a walk (permission prompts, auth titles,
//   metadata titles), each judged on its own, with a floor where deleting one
//   must fail too.
// - PINS: per-file must-have and must-lack lists. A rename that dropped the
//   brand altogether would pass every walk, so the sites a crawler, an inbox
//   or the OS reads are pinned by value.
// - The Settings recovery paths, which need more than a pattern.
//
// WHAT IS NOT COPY. Identifiers stay until the internals series after the
// beta: the `--signet-*` tokens and role names, `SignetMark`, `SignetCrest`,
// `SignetTokens`, `SIGNET_ENGINE_VERSION`, `@repo/theme/signet`,
// `signet-emblem-B.png`. The palette engine's server log lines name the
// design system's accent ("Signet accent contrast below AA"), the one phrase
// the API walk lets through. The binary's permanent identifiers are
// mobile-permanent-identifiers'; which permission prompts exist is
// scripts/check-mobile-native-declarations.mjs'; the @frapp.live ICS UID host
// is ics-uid-host's.
//
// SCOPE LIMITS, kept from the locks this replaces. Do not PATCH Auth, send
// mail or run eas init from here. Do not assert live staging titles (Vercel
// SSO, 1951). Do not lowercase the SMTP sender compare: the console value is
// `Frapp`. Do not assert TokenHash on the sibling mailer subjects (1926).

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { copyMatches, inLeadingComment, LINE_BREAK, SIGNET_DOWNLOAD_NAME } from "./helpers/copy-lines.mjs";
import { ROLLBACK_PLAYBOOK } from "../lib/ops-docs.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const SIGNET = /\bSignet\b/g;
const ZERO_ID = "00000000-0000-0000-0000-000000000000";
const TAGLINE = "Ask your chapter anything.";
const LANDING_HOME_TITLE = "Frapp. Ask your chapter anything.";

function literal(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const sources = new Map();
function read(rel) {
  if (!sources.has(rel)) sources.set(rel, readFileSync(join(REPO_ROOT, rel), "utf8"));
  return sources.get(rel);
}

// ---------------------------------------------------------------------------
// Walks. Dot entries and BUILD_DIRS are skipped unless a walk sets `all`. A
// `skip` entry with a slash is a repo path, skipped there only; one without is
// a directory name, skipped at any depth.

const BUILD_DIRS = ["node_modules", "dist", ".next", ".turbo", ".expo", "coverage"];
const NATIVE_PREBUILD = ["apps/mobile/ios", "apps/mobile/android"];

export const WALKS = {
  // The top-level `ios` and `android` are prebuild output, gitignored; a
  // tracked config plugin under a nested `android/` is still walked.
  mobile: { roots: ["apps/mobile"], ext: /\.(?:json|js|ts|tsx)$/, skip: NATIVE_PREBUILD, exclude: /\.spec\./ },
  mobileSpecs: { roots: ["apps/mobile"], ext: /\.(?:json|js|ts|tsx)$/, skip: NATIVE_PREBUILD, only: /\.spec\./ },
  api: { roots: ["apps/api/src"], ext: /\.ts$/, exclude: /\.spec\.ts$/ },
  // The dashboard renders copy from every package, so every `packages/*/src`
  // is walked, one added later included. A package's manifest and assets are
  // not copy. apps/web/tests holds fixtures, not shipped code.
  web: {
    roots: () => ["apps/web", ...packageSources()],
    ext: /\.(?:json|js|mjs|ts|tsx)$/,
    skip: ["tests"],
    exclude: /\.(?:spec|test)\./,
  },
  // Every directory under app/ is a route segment, `coverage` and `.well-known` included.
  webApp: { roots: ["apps/web/app"], ext: /\.(?:ts|tsx)$/, exclude: /\.spec\./, all: true },
  landing: { roots: ["apps/landing"], ext: /\.(?:ts|tsx)$/, skip: ["public"], exclude: /\.(?:spec|test)\.|\.d\.ts$/ },
  // Every product source, specs included: `Signet System` is never a note.
  product: { roots: ["apps/web", "apps/api", "apps/mobile", "packages"], ext: /\.(?:ts|tsx|js|mjs)$/ },
  validation: { roots: ["packages/validation"], ext: /(?:^|\/)ops-nudges\.ts$/ },
};

function packageSources() {
  return readdirSync(join(REPO_ROOT, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(REPO_ROOT, "packages", entry.name, "src")))
    .map((entry) => `packages/${entry.name}/src`);
}

function walkDir(rel, spec, out) {
  for (const entry of readdirSync(join(REPO_ROOT, rel), { withFileTypes: true })) {
    if (!spec.all && entry.name.startsWith(".")) continue;
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      const skipped = (spec.skip ?? []).some((name) => (name.includes("/") ? name === child : name === entry.name));
      if ((spec.all || !BUILD_DIRS.includes(entry.name)) && !skipped) walkDir(child, spec, out);
      continue;
    }
    if (!entry.isFile() || !spec.ext.test(entry.name)) continue;
    if (spec.exclude?.test(entry.name)) continue;
    if (spec.only && !spec.only.test(entry.name)) continue;
    out.push(child);
  }
  return out;
}

const walked = new Map();
/** Repo-relative paths a walk reaches, sorted. */
export function walk(name) {
  if (!walked.has(name)) {
    const spec = WALKS[name];
    const roots = typeof spec.roots === "function" ? spec.roots() : spec.roots;
    walked.set(name, roots.flatMap((root) => walkDir(root, spec, [])).sort());
  }
  return walked.get(name);
}

function files(name) {
  return walk(name).map((rel) => ({ rel, source: read(rel) }));
}

// ---------------------------------------------------------------------------
// COPY_WALKS. `reach` names files each walk must keep, so a root can't be
// dropped or narrowed without failing.

/** Where a design-system "Signet" starts in the API: the palette engine's accent log lines. */
export const API_DESIGN_SYSTEM_PHRASE = /^Signet accent (?:contrast|fill)\b/;

export const COPY_WALKS = [
  {
    surface: "mobile",
    walk: "mobile",
    bans: [SIGNET, SIGNET_DOWNLOAD_NAME],
    reach: ["apps/mobile/app.json", "apps/mobile/app/(auth)/sign-in.tsx"],
  },
  {
    // The committed openapi.json is what /docs serves.
    surface: "api",
    walk: "api",
    extra: ["apps/api/openapi.json"],
    bans: [SIGNET, SIGNET_DOWNLOAD_NAME],
    allow: API_DESIGN_SYSTEM_PHRASE,
    reach: ["apps/api/src/main.ts", "apps/api/src/application/services/report-export.service.ts"],
  },
  {
    // Unlike the API, the dashboard ships no design-system phrase.
    surface: "web",
    walk: "web",
    bans: [SIGNET, SIGNET_DOWNLOAD_NAME],
    reach: [
      "apps/web/app/layout.tsx",
      "apps/web/components/discord-import/connect-step.tsx",
      "packages/hooks/src/use-discord-connection.ts",
      "packages/validation/src/ops-nudges.ts",
      "packages/chat-core/src/index.ts",
      "packages/org-archetypes/src/index.ts",
    ],
    unreached: /^apps\/web\/tests\//,
  },
  {
    surface: "landing",
    walk: "landing",
    bans: [SIGNET],
    reach: [
      "apps/landing/app/layout.tsx",
      "apps/landing/app/opengraph-image.tsx",
      "apps/landing/app/page.tsx",
      "apps/landing/components/frapp-lockup.tsx",
      "apps/landing/app/support/page.tsx",
      "apps/landing/app/terms/page.tsx",
      "apps/landing/app/privacy/page.tsx",
      "apps/landing/app/ferpa/page.tsx",
    ],
  },
];

/** `file:line` for each banned copy match in `files` under one COPY_WALKS row. */
export function copyProblems(row, list) {
  return row.bans.flatMap((ban) =>
    copyMatches(list, ban)
      .filter(({ text, match }) => !row.allow?.test(text.slice(match.index)))
      .map(({ rel, line }) => `${rel}:${line}`),
  );
}

function copyWalkFiles(row) {
  return [...files(row.walk), ...(row.extra ?? []).map((rel) => ({ rel, source: read(rel) }))];
}

// ---------------------------------------------------------------------------
// TEXT_BANS. Whole-file, comments included. `reach` as in COPY_WALKS: an
// empty walk would pass every ban.

export const TEXT_BANS = [
  // The seeded system actor (users.id all zeros). Chat cards don't print it
  // today, so a revert would be silent on the UI.
  {
    walk: "product",
    ban: /Signet System/,
    reach: ["apps/api/src/main.ts", "apps/web/app/layout.tsx", "apps/mobile/app/(auth)/sign-in.tsx", "packages/validation/src/index.ts"],
  },
  // Specs keep design-system test names ("no Signet map"), so they aren't
  // walked for the word, only for the payment fixtures a sweep would copy
  // back into stripe.ts or the balance card.
  { walk: "mobileSpecs", ban: /merchantDisplayName:\s*"Signet"/, reach: ["apps/mobile/lib/payments/stripe.spec.ts"] },
  { walk: "mobileSpecs", ban: /installed Signet build/, reach: ["apps/mobile/components/dues/balance-card.spec.tsx"] },
];

export function textBanProblems(row, list) {
  return list.filter(({ source }) => row.ban.test(source)).map(({ rel }) => `${rel}: ${row.ban}`);
}

// ---------------------------------------------------------------------------
// SITE_ROSTERS.

/** `title=` and `subtitle=` props, double-, single- or JS-quoted. */
export function jsxProp(source, prop) {
  const pattern = new RegExp(`\\b${prop}=(?:["']([^"']+)["']|\\{\\s*["']([^"']+)["']\\s*\\})`, "g");
  return [...source.matchAll(pattern)].map((match) => match[1] || match[2]);
}

/** JSON-quoted `*Permission` keys, and the unquoted JS form Expo config files use. `false` is not a prompt. */
export function permissionStrings(source) {
  const pattern = /(?:^|[\s,{])(?:"([A-Za-z]+Permission)"|([A-Za-z]+Permission)):\s*["']([^"']+)["']/gm;
  return [...source.matchAll(pattern)].map((match) => ({ key: match[1] || match[2], value: match[3] }));
}

export const SITE_ROSTERS = [
  {
    kind: "invite email copy",
    walk: "api",
    is: (source) => /DEFAULT_FROM_ADDRESS/.test(source) || /You're invited to join a chapter/.test(source),
    sites: [
      "apps/api/src/infrastructure/email/resend-email.provider.ts",
      "apps/api/src/modules/email/email.module.ts",
    ],
  },
  {
    // main.ts serves /docs and export-openapi.ts writes openapi.json; CI only
    // builds the exported one, so a second builder could drift unseen.
    kind: "OpenAPI DocumentBuilder",
    walk: "api",
    is: (source) => /new DocumentBuilder\(\)/.test(source),
    sites: ["apps/api/src/openapi-config.ts"],
  },
  {
    kind: "ops-nudge catalog",
    walk: "validation",
    is: () => true,
    sites: ["packages/validation/src/ops-nudges.ts"],
  },
  {
    // Join, sign-up and no-access titles are not the product wordmark.
    kind: "web auth wordmark",
    walk: "webApp",
    is: (source) => jsxProp(source, "title").some((title) => title === "Frapp" || title === "Signet"),
    sites: ["apps/web/app/page.tsx", "apps/web/app/sign-in/page.tsx"],
  },
  {
    kind: "mobile permission and Expo Go copy",
    walk: "mobile",
    is: (source) =>
      permissionStrings(source).length > 0 ||
      /export function stripeUnavailableReason/.test(source) ||
      /export function pushUnavailableReason/.test(source) ||
      /merchantDisplayName:\s*chapterName \?\?/.test(source),
    sites: [
      "apps/mobile/app.json",
      "apps/mobile/app/(tabs)/dues.tsx",
      "apps/mobile/lib/notifications/push.ts",
      "apps/mobile/lib/payments/stripe.ts",
    ],
  },
];

export function rosterSites(row, list) {
  return list.filter(({ source }) => row.is(source)).map(({ rel }) => rel).sort();
}

// ---------------------------------------------------------------------------
// COLLECTED.

/** `export const metadata` titles, single- or double-quoted, plus a marker for generateMetadata. */
export function webMetadataTitles(source) {
  const titles = /export (?:async )?function generateMetadata/.test(source) ? ["__generateMetadata__"] : [];
  if (!/export const metadata/.test(source)) return titles;
  for (const block of source.matchAll(/export const metadata(?:\s*:\s*Metadata)?\s*=\s*\{([\s\S]*?)\}/g)) {
    for (const title of block[1].matchAll(/title:\s*["']([^"']+)["']/g)) titles.push(title[1]);
  }
  return titles;
}

export function landingMetadataTitles(source) {
  if (!/export const metadata/.test(source)) return [];
  return [...source.matchAll(/title:\s*(["'])([^"']+)\1/g)].map((match) => match[2]);
}

/** Each landing route's own title. A route missing here inherits the homepage `<head>`. */
export const LANDING_ROUTE_TITLES = {
  "apps/landing/app/support/page.tsx": "Support · Frapp",
  "apps/landing/app/terms/page.tsx": "Terms of Service · Frapp",
  "apps/landing/app/privacy/page.tsx": "Privacy Policy · Frapp",
  "apps/landing/app/ferpa/page.tsx": "FERPA Notice · Frapp",
};

/** Routes with no `<head>` of their own: the homepage owns the root one, and /join only redirects. */
export const LANDING_NO_METADATA = ["apps/landing/app/page.tsx", "apps/landing/app/join/page.tsx"];

export const COLLECTED = [
  {
    // Whatever prompts exist must name Frapp, never Signet.
    what: "mobile *Permission prompt",
    walk: "mobile",
    collect: (source) => permissionStrings(source).map(({ key, value }) => ({ key, value })),
    wrong: (value) => !/\bFrapp\b/.test(value) || /\bSignet\b/.test(value),
  },
  {
    what: "web auth title",
    walk: "webApp",
    collect: (source) => jsxProp(source, "title").map((value) => ({ key: "title", value })),
    wrong: (value) => value === "Signet",
  },
  {
    what: "web auth subtitle",
    walk: "webApp",
    collect: (source) => jsxProp(source, "subtitle").map((value) => ({ key: "subtitle", value })),
    wrong: (value) => /\bSignet\b/.test(value),
  },
  {
    // The root layout's `title.template` appends " · Frapp" (#2147), so a
    // route title that names the product renders it twice. generateMetadata
    // must be taught to the collector before it can hide a title. 18: the
    // seventeen route titles plus (dashboard)/points/layout.tsx, which exists
    // only to carry one for a Client Component page.
    what: "web metadata title",
    walk: "webApp",
    collect: (source) => webMetadataTitles(source).map((value) => ({ key: "title", value })),
    wrong: (value) => value === "__generateMetadata__" || /Frapp|Signet/.test(value),
    min: 18,
  },
  {
    // Root + OG + Twitter on the layout, and one per legal route.
    what: "landing metadata title",
    walk: "landing",
    collect: (source) => landingMetadataTitles(source).map((value) => ({ key: "title", value })),
    wrong: (value) => !/Frapp/.test(value) || /Signet/.test(value),
    min: 7,
  },
];

export function collectedProblems(row, list) {
  const found = list.flatMap(({ rel, source }) => row.collect(source).map((item) => ({ rel, ...item })));
  const problems = found.filter(({ value }) => row.wrong(value)).map(({ rel, key, value }) => `${rel}:${key} ${value}`);
  if (row.min && found.length < row.min) problems.push(`${row.what}: found ${found.length}, floor ${row.min}`);
  return problems;
}

/** Every landing page.tsx but the two above exports metadata and has a pinned title. */
export function landingRouteCoverageProblems(list) {
  const problems = [];
  for (const { rel, source } of list) {
    if (!rel.endsWith("/page.tsx") || LANDING_NO_METADATA.includes(rel)) continue;
    if (!/export const metadata/.test(source)) problems.push(`${rel} has no metadata export`);
    if (!(rel in LANDING_ROUTE_TITLES)) problems.push(`${rel} has no pinned title in LANDING_ROUTE_TITLES`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// PINS. `has` and `lacks` take a string (included), a RegExp (tested),
// { re, min } / { re, exactly } for a global RegExp's match count, or
// { count, min } for a count a function takes. `section`
// narrows the source first; an empty section fails every `has`. `check` is
// for what a pattern can't say.

/** The body of `function name(...) { … }`, braces balanced. */
export function functionBody(source, name) {
  const start = source.search(new RegExp(`function ${name}\\(`));
  const open = start === -1 ? -1 : source.indexOf("{", start);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  return "";
}

/** One `## heading` section of a Markdown doc, up to the next `## `. */
export function markdownSection(source, heading) {
  const start = source.indexOf(`## ${heading}\n`);
  if (start === -1) return "";
  const next = source.indexOf("\n## ", start + 3);
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

/** The one string literal passed to `.setDescription(...)`, however Prettier wraps it. */
export function builderDescription(source) {
  const match = source.match(/\.setDescription\(\s*'([^']*)',?\s*\)/);
  return match ? match[1] : null;
}

const OPENAPI_CONFIG = "apps/api/src/openapi-config.ts";
const SYSTEM_MIGRATION = "20260924190000_rename_system_actor_to_frapp.sql";
const INVITE_BODY = "invited to join a chapter on Frapp as";
/** A count entry for PINS: how many `prop=` values in a file equal `value`, read by jsxProp. */
const propCount = (prop, value, min) => ({
  what: `${prop}="${value}"`,
  count: (source) => jsxProp(source, prop).filter((found) => found === value).length,
  min,
});

export const PINS = [
  // --- Auth, as staging-conformance checks it (ADR-25 step 3) -------------
  {
    file: "scripts/ci/staging-conformance.mjs",
    why: "Auth SMTP sender name, and the Signet leftover guard on mailer subjects and the Magic Link body",
    has: [
      /export const AUTH_SMTP_SENDER_NAME = "Frapp"/,
      /senderName !== AUTH_SMTP_SENDER_NAME/,
      /typeof data\?\.smtp_sender_name === "string" \? data\.smtp_sender_name\.trim\(\)/,
      // An operator turning SMTP back on must learn the check wants Frapp.
      /smtp_sender_name=\$\{AUTH_SMTP_SENDER_NAME\}/,
      /export function leftoverSignetMailerSubjectKeys/,
      /key\.startsWith\("mailer_subjects_"\)/,
      /\/Signet\/i\.test\(value\)/,
      /const leftoverSubjects = leftoverSignetMailerSubjectKeys\(data\)/,
      /mailer_subjects contain Signet/,
      /export const SIGNET_PRODUCT_NAME = \/Signet\|SIGNET\/;/,
      /if \(SIGNET_PRODUCT_NAME\.test\(content\)\) \{/,
    ],
    lacks: [/AUTH_SMTP_SENDER_NAME = "Signet"/, /smtp_sender_name\.trim\(\)\.toLowerCase\(\)/],
  },

  // --- API ----------------------------------------------------------------
  {
    file: OPENAPI_CONFIG,
    why: "the public /docs title, from the one DocumentBuilder",
    has: [/\.setTitle\('Frapp API'\)/, /\.setDescription\(/],
    lacks: [/\.setTitle\('Signet API'\)/],
  },
  ...["apps/api/src/main.ts", "apps/api/src/export-openapi.ts"].map((file) => ({
    file,
    why: "both entry points build their document from the shared config",
    has: [
      "import { buildOpenApiConfig } from './openapi-config';",
      /SwaggerModule\.createDocument\(\s*app,\s*buildOpenApiConfig\(\),?\s*\)/,
    ],
  })),
  {
    file: "apps/api/openapi.json",
    why: "the committed contract carries the builder's title and description, never the retired tagline",
    check(source) {
      const { title, description } = JSON.parse(source).info ?? {};
      const wanted = builderDescription(read(OPENAPI_CONFIG));
      const problems = [];
      if (title !== "Frapp API") problems.push(`info.title is ${title}, not Frapp API`);
      if (description !== wanted) problems.push("info.description is stale; run npm run openapi:export -w apps/api");
      if (/The Operating System for Greek Life|\bSignet\b/.test(wanted ?? "")) problems.push("the builder description names Signet or the retired tagline");
      return problems;
    },
  },
  {
    file: "apps/api/src/application/services/report-export.service.ts",
    why: "the report PDF download name",
    has: ["`frapp-${kind}-report-"],
  },
  {
    file: "apps/api/src/application/services/event.service.ts",
    why: "the API's ICS PRODID",
    has: ["PRODID:-//Frapp//Events//EN"],
  },
  {
    // The From host stays mail.frapp.live; frapp.live is the burned apex.
    file: "apps/api/src/modules/email/email.module.ts",
    why: "invite email From",
    has: ["const DEFAULT_FROM_ADDRESS = 'Frapp <invites@mail.frapp.live>'", "RESEND_FROM_EMAIL"],
    lacks: [/const DEFAULT_FROM_ADDRESS = 'Signet /, /const DEFAULT_FROM_ADDRESS = '[^']*<invites@frapp\.live>'/, SIGNET],
  },
  {
    file: "apps/api/src/infrastructure/email/resend-email.provider.ts",
    why: "invite email subject",
    has: ["You're invited to join a chapter on Frapp"],
    lacks: [SIGNET],
  },
  // HTML and text bodies are pinned apart, so one can't hide a leftover in the other.
  ...["inviteEmailHtml", "inviteEmailText"].map((name) => ({
    file: "apps/api/src/infrastructure/email/resend-email.provider.ts",
    section: (source) => functionBody(source, name),
    why: `${name} body`,
    has: [INVITE_BODY],
  })),

  // --- The seeded system actor --------------------------------------------
  // Three migrations as written: a migration that already ran is renamed by a
  // new one, never edited.
  {
    file: `supabase/migrations/${SYSTEM_MIGRATION}`,
    why: "the newest forward migration names the system actor Frapp System",
    has: ["set display_name = 'Frapp System'", `where id = '${ZERO_ID}'`],
    lacks: ["set display_name = 'Signet System'"],
  },
  {
    file: "supabase/migrations/20260909120000_rename_system_user_display_name.sql",
    why: "the 2026-09-09 migration still sets Signet System, as it ran",
    has: ["set display_name = 'Signet System'"],
    lacks: ["set display_name = 'Frapp System'"],
  },
  {
    file: "supabase/migrations/20260524120000_chapter_directory_requests.sql",
    why: "the historical seed inserts Frapp System as system@frapp.local",
    has: ["'Frapp System'", "system@frapp.local"],
    lacks: ["'Signet System'", "system@signet.local"],
  },
  {
    file: "scripts/check-pglite-migrations.mjs",
    why: "the PGlite landmark requires Frapp System after replay",
    has: ['display_name === "Frapp System"', "seeded system actor display_name is Frapp System"],
    lacks: ['display_name === "Signet System"'],
  },
  {
    // @repo/validation owns the literal so both clients can hide Block on a
    // system message; the API re-exports it rather than keep a second copy.
    file: "packages/validation/src/index.ts",
    why: "SYSTEM_SENDER_ID is the all-zeros id",
    has: [new RegExp(`export const SYSTEM_SENDER_ID = ["']${ZERO_ID}["']`)],
  },
  {
    file: "apps/api/src/domain/constants/chat.ts",
    why: "the API re-exports SYSTEM_SENDER_ID instead of keeping its own",
    has: [/export \{ SYSTEM_SENDER_ID \} from ['"]@repo\/validation['"]/],
    lacks: [/SYSTEM_SENDER_ID\s*=/],
  },
  {
    file: ROLLBACK_PLAYBOOK,
    section: (source) => markdownSection(source, "Rollback the Frapp System display_name"),
    why: "the rollback recipe restores Signet System and names its migration",
    has: [
      `* **Migration**: \`${SYSTEM_MIGRATION}\``,
      `set display_name = 'Signet System' where id = '${ZERO_ID}'`,
    ],
    lacks: ["set display_name = 'Frapp System' where id ="],
  },

  // --- Web dashboard (ADR-25 step 4) ---------------------------------------
  {
    file: "packages/validation/src/ops-nudges.ts",
    why: "the ops-nudge headlines the dashboard renders",
    has: [/headline:\s*"Collect dues in Frapp"/, /headline:\s*"Run your calendar in Frapp"/],
    lacks: [/headline:\s*"[^"]*\bSignet\b/, /description:\s*"[^"]*\bSignet\b/],
  },
  {
    // A rename that drops the brand altogether passes the walk. Only the CSV
    // name also has a unit spec (apps/web/lib/utils.spec.ts), so for the .ics
    // fallback and the invite header these pins are the only check. The
    // fallback's `.ics` is also on the next line, out of the download-name ban's sight.
    file: "apps/web/lib/utils.ts",
    why: "the CSV download name",
    has: ["`frapp-${filenamePrefix}-"],
  },
  {
    file: "apps/web/components/events/event-detail-sheet.tsx",
    why: "the empty-title .ics fallback",
    has: ['|| "frapp-event"'],
  },
  {
    file: "apps/web/components/members/invite-member-dialog.tsx",
    why: "the invite share header",
    has: ['"Frapp member invite",'],
  },
  {
    // The template puts the name in every child tab and `default` serves the
    // root segment's own page: a template without a default is a Next error,
    // and a default without a template drops the name from every route.
    file: "apps/web/app/layout.tsx",
    why: "the one place the dashboard spells the product name",
    has: ['template: "%s · Frapp"', 'default: "Frapp"', `description: "${TAGLINE}"`],
  },
  {
    file: "apps/web/app/page.tsx",
    why: "the web home wordmark and brand tagline",
    has: [propCount("title", "Frapp", 1), propCount("subtitle", TAGLINE, 1)],
  },
  {
    file: "apps/web/app/sign-in/page.tsx",
    why: "the sign-in form's and its Suspense fallback's wordmark and tagline",
    has: [propCount("title", "Frapp", 2), propCount("subtitle", TAGLINE, 2)],
  },

  // --- Mobile (ADR-25 step 2) ----------------------------------------------
  {
    // iOS Settings lists the app under expo.name.
    file: "apps/mobile/app.json",
    why: "the binary's display name",
    check: (source) => {
      const name = JSON.parse(source).expo?.name;
      return name === "Frapp" ? [] : [`expo.name must be Frapp, not ${name}`];
    },
  },
  {
    // Mobile sign-in carries the landing's D8 line, not the brand tagline: a
    // build without Ask must not open on "Ask your chapter anything." for App
    // Review (#2298, owner 2026-09-22). Move it back in the slice that ships Ask.
    file: "apps/mobile/app/(auth)/sign-in.tsx",
    why: "the mobile sign-in wordmark and tagline",
    has: [
      "<Text style={styles.title}>Frapp</Text>",
      // Prettier may move a long JSX child onto its own line; it renders the same.
      /<Text style=\{styles\.subtitle\}>\s*Everything your chapter needs is already in chat\.\s*<\/Text>/,
    ],
  },
  {
    file: "apps/mobile/lib/calendar-export.ts",
    why: "the mobile ICS PRODID and filename fallback",
    has: ["PRODID:-//Frapp//Chapter Events//EN", /\|\| "frapp-event"\}\.ics/],
  },
  {
    file: "apps/mobile/lib/payments/stripe.ts",
    why: "the Expo Go pay sentence",
    has: ["export function stripeUnavailableReason", "installed Frapp build", "Frapp mobile app"],
  },
  {
    file: "apps/mobile/lib/notifications/push.ts",
    why: "the Expo Go push sentence",
    has: ["export function pushUnavailableReason", "installed Frapp build"],
  },
  {
    file: "apps/mobile/app/(tabs)/dues.tsx",
    why: "the PaymentSheet merchant default",
    has: [/merchantDisplayName:\s*chapterName \?\? "Frapp"/],
    lacks: [/merchantDisplayName:\s*chapterName \?\? "Signet"/],
  },
  {
    file: "apps/mobile/lib/payments/stripe.spec.ts",
    why: "the payment fixture",
    has: [/merchantDisplayName:\s*"Frapp"/],
  },
  {
    file: "apps/mobile/components/dues/balance-card.spec.tsx",
    why: "the payment fixture",
    has: ["installed Frapp build"],
  },

  // --- Landing and legal (ADR-25 step 5) -----------------------------------
  {
    file: "apps/landing/app/layout.tsx",
    why: "the root, OG and Twitter titles",
    has: [{ re: new RegExp(`title: ["']${literal(LANDING_HOME_TITLE)}["']`, "g"), exactly: 3 }],
  },
  // A route that set only `title` would inherit the layout's openGraph and
  // twitter (Next merges metadata by top-level key) and preview as the
  // homepage, so each goes through routeMetadata with its own title and path.
  ...Object.entries(LANDING_ROUTE_TITLES).map(([file, title]) => ({
    file,
    why: "the route names itself",
    has: [
      "export const metadata: Metadata = routeMetadata({",
      new RegExp(`title: ["']${literal(title)}["']`),
      new RegExp(`path: ["']/${file.split("/").at(-2)}["']`),
    ],
  })),
  {
    file: "apps/landing/lib/route-metadata.ts",
    section: (source) => /openGraph: \{([\s\S]*?)\n {4}\},/.exec(source)?.[1] ?? "",
    why: "routeMetadata restates openGraph",
    has: [/\btitle,/, "url: path,", "images: [SHARE_IMAGE]"],
  },
  {
    file: "apps/landing/lib/route-metadata.ts",
    section: (source) => /twitter: \{([\s\S]*?)\n {4}\},/.exec(source)?.[1] ?? "",
    why: "routeMetadata restates the Twitter card",
    has: [/\btitle,/, 'card: "summary_large_image"'],
  },
  {
    file: "apps/landing/lib/route-metadata.ts",
    why: "the share image alt",
    has: [new RegExp(`alt: ["']${literal(LANDING_HOME_TITLE)}["']`)],
  },
  {
    // The wordmark drawn into the card is JSX text on a line of its own.
    file: "apps/landing/app/opengraph-image.tsx",
    why: "the OG card's alt and wordmark",
    has: [new RegExp(`^export const alt = ["']${literal(LANDING_HOME_TITLE)}["'];$`, "m"), /^\s*Frapp\s*$/m],
  },
  {
    file: "apps/landing/app/page.tsx",
    why: "the JSON-LD application and brand names",
    has: [{ re: /name:\s*(["'])Frapp\1/g, exactly: 2 }],
    lacks: [/name:\s*(["'])Signet\1/],
  },
  {
    // Owner, 2026-09-28: the header crest sits on the page with no tile
    // (spec/ui/assets.md §3).
    file: "apps/landing/components/frapp-lockup.tsx",
    why: "the header lockup",
    has: [/aria-label=["']Frapp["']/, ">Frapp</span>"],
    lacks: [/\bbg-/],
  },
  {
    // The landing spec announces its reskin status at the top. Retire the
    // banner when the reskin's owner decisions close, and this row with it.
    file: "spec/ui/landing/README.md",
    why: "the landing spec's status banner",
    has: ["> **RESKIN BUILT OUT**"],
  },
];

function describe(entry) {
  if (typeof entry === "string") return JSON.stringify(entry);
  if (entry.count) return `${entry.min}+ ${entry.what}`;
  return String(entry.re ?? entry);
}

function holds(source, entry) {
  if (typeof entry === "string") return source.includes(entry);
  if (entry instanceof RegExp) return new RegExp(entry.source, entry.flags.replace("g", "")).test(source);
  const count = entry.count ? entry.count(source) : [...source.matchAll(entry.re)].length;
  return entry.exactly === undefined ? count >= entry.min : count === entry.exactly;
}

/** Problems with one pin, given the file's source. */
export function pinProblems(pin, source) {
  const scoped = pin.section ? pin.section(source) : source;
  const at = `${pin.file} (${pin.why})`;
  return [
    ...(pin.has ?? []).filter((entry) => !scoped || !holds(scoped, entry)).map((entry) => `${at} must have ${describe(entry)}`),
    ...(pin.lacks ?? []).filter((entry) => holds(scoped, entry)).map((entry) => `${at} must not have ${describe(entry)}`),
    ...(pin.check?.(scoped) ?? []).map((problem) => `${at}: ${problem}`),
  ];
}

// ---------------------------------------------------------------------------
// The Settings recovery paths. Each site keeps a `Settings → <expo.name> →
// Location` path in code (iOS 18's `Settings → Apps → <name> → Location`
// counts). Other `Settings →` paths aren't judged: telling an app path from a
// system one takes more than a pattern, and the mobile walk still catches a
// Signet in any of them.

export const SETTINGS_SITES = ["apps/mobile/app/(tabs)/study.tsx", "apps/mobile/components/study/location-primer-sheet.tsx"];

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
 * The path counts only when it is certainly code: not in its line's leading
 * comment, not after a `//` or `/*` on its line, and not below an open `/*`,
 * so a comment can't stand in for a deleted path. That last check takes the
 * nearest `/*` above the path wherever it sits and fails closed, so when the
 * pin fails on copy that reads right, look at the nearest `/*` above it. The
 * first letter of `Settings`, `Apps` and `Location` may be either case, and
 * quotes around the name, escaped or not, are optional; the name must match.
 */
export function settingsPathProblems(list, expoName) {
  const pin = new RegExp(
    `[Ss]ettings\\s*→\\s*(?:[Aa]pps\\s*→\\s*)?\\\\?["'“‘]?${literal(expoName)}\\\\?["'”’]?\\s*→\\s*[Ll]ocation\\b`,
    "g",
  );
  return SETTINGS_SITES.filter((site) => {
    const file = list.find((candidate) => candidate.rel === site);
    return !(
      file &&
      [...file.source.matchAll(pin)].some((match) => {
        const { text, column } = lineAt(file.source, match.index);
        const note = inLeadingComment(text, column) || /\/\/|\/\*/.test(text.slice(0, column));
        return !note && !blockOpenBefore(file.source, match.index);
      })
    );
  }).map((site) => `${site} must keep its Settings → ${expoName} → Location path`);
}

// ---------------------------------------------------------------------------
// The lock, live.

for (const row of COPY_WALKS) {
  test(`the ${row.surface} copy says Frapp, never Signet`, () => {
    const list = copyWalkFiles(row);
    for (const rel of row.reach) assert.ok(list.some((file) => file.rel === rel), `the ${row.surface} walk must reach ${rel}`);
    if (row.unreached) assert.ok(!list.some((file) => row.unreached.test(file.rel)), `the ${row.surface} walk must skip ${row.unreached}`);
    assert.deepEqual(copyProblems(row, list), []);
  });
}

test("no whole-file Signet leftovers", () => {
  for (const row of TEXT_BANS) {
    const list = files(row.walk);
    for (const rel of row.reach) assert.ok(list.some((file) => file.rel === rel), `the ${row.walk} walk must reach ${rel}`);
    assert.deepEqual(textBanProblems(row, list), [], String(row.ban));
  }
});

for (const row of SITE_ROSTERS) {
  test(`${row.kind} lives only where it is pinned`, () => {
    assert.deepEqual(rosterSites(row, files(row.walk)), [...row.sites].sort());
  });
}

for (const row of COLLECTED) {
  test(`every ${row.what} says the right name`, () => {
    assert.deepEqual(collectedProblems(row, files(row.walk)), []);
  });
}

test("every landing route but the homepage and /join names itself", () => {
  assert.deepEqual(landingRouteCoverageProblems(files("landing")), []);
});

test("every pinned site holds its value", () => {
  assert.deepEqual(PINS.flatMap((pin) => pinProblems(pin, read(pin.file))), []);
});

test("both Settings recovery paths name expo.name", () => {
  const expoName = JSON.parse(read("apps/mobile/app.json")).expo.name;
  assert.deepEqual(settingsPathProblems(files("mobile"), expoName), []);
  // Renaming the binary without its Settings paths fails.
  assert.equal(settingsPathProblems(files("mobile"), "Signet").length, SETTINGS_SITES.length);
});

// Lowering a floor or moving a root in the table above takes a second,
// matching edit here, so the change can't hide in one number. The locks this
// replaces each held the same check on their own constants.
test("the table keeps its floors and roots", () => {
  const floor = (what) => COLLECTED.find((row) => row.what === what).min;
  assert.equal(floor("web metadata title"), 18);
  assert.equal(floor("landing metadata title"), 7);
  const pinned = (file) => PINS.filter((pin) => pin.file === file).flatMap((pin) => pin.has ?? []);
  assert.deepEqual(pinned("apps/web/app/page.tsx").map((entry) => entry.min), [1, 1]);
  assert.deepEqual(pinned("apps/web/app/sign-in/page.tsx").map((entry) => entry.min), [2, 2]);
  assert.equal(pinned("apps/landing/app/layout.tsx")[0].exactly, 3);
  assert.equal(pinned("apps/landing/app/page.tsx")[0].exactly, 2);
  assert.deepEqual(SETTINGS_SITES, ["apps/mobile/app/(tabs)/study.tsx", "apps/mobile/components/study/location-primer-sheet.tsx"]);
  assert.deepEqual(SITE_ROSTERS.find((row) => row.kind === "ops-nudge catalog").sites, ["packages/validation/src/ops-nudges.ts"]);
  const roots = Object.fromEntries(
    Object.entries(WALKS).map(([name, spec]) => [name, typeof spec.roots === "function" ? spec.roots() : spec.roots]),
  );
  assert.deepEqual(roots.mobile, ["apps/mobile"]);
  assert.deepEqual(roots.mobileSpecs, ["apps/mobile"]);
  assert.deepEqual(roots.api, ["apps/api/src"]);
  assert.deepEqual(roots.web, ["apps/web", ...packageSources()]);
  assert.deepEqual(roots.webApp, ["apps/web/app"]);
  assert.deepEqual(roots.landing, ["apps/landing"]);
  assert.deepEqual(roots.product, ["apps/web", "apps/api", "apps/mobile", "packages"]);
  assert.deepEqual(roots.validation, ["packages/validation"]);
  assert.ok(String(WALKS.mobile.ext).includes("json"), "the mobile walk must read app.json, not only code");
});

// ---------------------------------------------------------------------------
// The rules, on fixtures. Each pins a way a predicate above was once fooled
// or narrowed; the line rule itself is ./helpers/copy-lines.mjs's, tested in
// copy-lines.test.mjs.

test("the API lets the design-system accent phrase through, and nothing after it", () => {
  const api = COPY_WALKS.find((row) => row.surface === "api");
  const rel = "apps/api/src/application/services/chapter-palette.ts";
  const allowed = [
    "logger.warn(`Signet accent contrast below AA ${where}`);",
    "logger.warn(`Signet accent fill below 3:1 ${where}`);",
  ];
  assert.deepEqual(copyProblems(api, [{ rel, source: allowed.join("\n") }]), []);
  const reported = [
    "const a = 'Signet accent';",
    "const b = 'Signet support will reply';",
    "description: 'Signet §8 contrast checks below AA for this save.',",
    "throw new Error('Signet could not read that Discord server.');",
  ];
  assert.deepEqual(copyProblems(api, [{ rel, source: reported.join("\n") }]), [`${rel}:1`, `${rel}:2`, `${rel}:3`, `${rel}:4`]);
  // The web walk has no such phrase.
  const web = COPY_WALKS.find((row) => row.surface === "web");
  assert.deepEqual(copyProblems(web, [{ rel, source: allowed[0] }]), [`${rel}:1`]);
});

test("a signet- download name fails every walk that bans it", () => {
  const source = "downloadBlob(blob, `signet-${filenamePrefix}-${day}.csv`);\n";
  for (const row of COPY_WALKS.filter((candidate) => candidate.bans.includes(SIGNET_DOWNLOAD_NAME))) {
    assert.equal(copyProblems(row, [{ rel: "x.ts", source }]).length, 1, row.surface);
  }
});

test("jsxProp reads double-, single- and JS-quoted props", () => {
  assert.deepEqual(jsxProp('<AuthScreen title="Frapp" subtitle=\'Ask\' />', "title"), ["Frapp"]);
  assert.deepEqual(jsxProp("<AuthScreen title='Signet' />", "title"), ["Signet"]);
  assert.deepEqual(jsxProp("<AuthScreen title={'Signet'} />", "title"), ["Signet"]);
  assert.deepEqual(jsxProp('<AuthScreen title="Frapp" subtitle="Ask Signet anything." />', "subtitle"), ["Ask Signet anything."]);
});

test("permissionStrings reads JSON and unquoted JS keys, and skips a disabled prompt", () => {
  assert.deepEqual(permissionStrings('{ "cameraPermission": "Frapp uses the camera." }'), [
    { key: "cameraPermission", value: "Frapp uses the camera." },
  ]);
  assert.deepEqual(permissionStrings('module.exports = { cameraPermission: "Signet uses the camera." };'), [
    { key: "cameraPermission", value: "Signet uses the camera." },
  ]);
  assert.deepEqual(permissionStrings('"microphonePermission": false'), []);
  // Each half of the naming rule fails on its own.
  const prompt = COLLECTED.find((row) => row.what === "mobile *Permission prompt");
  assert.ok(prompt.wrong("Frapp (formerly Signet) uses the camera."));
  assert.ok(prompt.wrong("Allow the app to use the camera."));
  assert.ok(!prompt.wrong("Frapp uses the camera."));
});

test("metadata collectors read single quotes and refuse generateMetadata", () => {
  assert.deepEqual(webMetadataTitles("export const metadata = {\n  title: 'Signet — Admin'\n}"), ["Signet — Admin"]);
  assert.deepEqual(webMetadataTitles("export async function generateMetadata() {}"), ["__generateMetadata__"]);
  assert.deepEqual(landingMetadataTitles("export const metadata = {\n  title: 'Signet — Privacy',\n};\n"), ["Signet — Privacy"]);
  assert.deepEqual(landingMetadataTitles("const x = { title: 'Frapp' };"), []);
});

test("collectedProblems enforces the floor", () => {
  const row = COLLECTED.find((candidate) => candidate.what === "landing metadata title");
  const rel = "apps/landing/app/privacy/page.tsx";
  assert.deepEqual(collectedProblems(row, [{ rel, source: "export const metadata = {\n  title: 'Signet — Privacy',\n};\n" }]), [
    `${rel}:title Signet — Privacy`,
    "landing metadata title: found 1, floor 7",
  ]);
});

test("a new landing route without metadata fails", () => {
  const rel = "apps/landing/app/accessibility/page.tsx";
  assert.deepEqual(landingRouteCoverageProblems([{ rel, source: "export default function A() { return null; }\n" }]), [
    `${rel} has no metadata export`,
    `${rel} has no pinned title in LANDING_ROUTE_TITLES`,
  ]);
});

test("a pin's section must exist, or every has fails", () => {
  const pin = { file: "x.ts", why: "w", section: (source) => functionBody(source, "missing"), has: ["a"] };
  assert.deepEqual(pinProblems(pin, "function present() { a }"), ['x.ts (w) must have "a"']);
  assert.equal(functionBody("function f(x) { if (x) { return 1; } }", "f"), " if (x) { return 1; } ");
  const doc = "## Rollback a\n* one\n## Rollback b\n* two\n";
  assert.equal(markdownSection(doc, "Rollback a"), "## Rollback a\n* one");
  assert.equal(markdownSection(doc, "Rollback b"), "## Rollback b\n* two\n");
  assert.equal(markdownSection(doc, "Rollback c"), "");
  assert.equal(builderDescription(".setDescription(\n      'Wrapped by Prettier.',\n    )"), "Wrapped by Prettier.");
  assert.equal(builderDescription(".setTitle('Frapp API')"), null);
});

test("pin counts: min and exactly", () => {
  const pin = { file: "x", why: "w", has: [{ re: /a/g, min: 2 }, { re: /b/g, exactly: 1 }] };
  assert.deepEqual(pinProblems(pin, "a a b"), []);
  assert.equal(pinProblems(pin, "a b b").length, 2);
});

const STUDY = SETTINGS_SITES[0];
const PRIMER = SETTINGS_SITES[1];
const recovery = (rel, name = "Frapp") => ({ rel, source: `const r = "Turn it on in Settings → ${name} → Location.";\n` });

test("both Settings paths must be in code and name expo.name", () => {
  assert.deepEqual(settingsPathProblems([recovery(STUDY), recovery(PRIMER)], "Frapp"), []);
  const lost = `${PRIMER} must keep its Settings → Frapp → Location path`;
  assert.deepEqual(settingsPathProblems([recovery(STUDY)], "Frapp"), [lost]);
  for (const source of [
    "// Settings → Frapp → Location\n",
    "Linking.openSettings(); // was: Settings → Frapp → Location\n<Text>Turn location on.</Text>\n",
    "/*\n  old copy: Settings → Frapp → Location\n*/\n<Text>Turn location on.</Text>\n",
    "/*/\n  old copy: Settings → Frapp → Location\n*/\n<Text>Turn location on.</Text>\n",
    "<Text>Turn it on in Settings → Frapp → Photos.</Text>\n",
  ]) {
    assert.deepEqual(settingsPathProblems([recovery(STUDY), { rel: PRIMER, source }], "Frapp"), [lost], source);
  }
  for (const source of [
    "<Text>\n  Turn it on in Settings →\n  Frapp → Location.\n</Text>\n",
    "<Text>Turn it on in Settings → Apps → Frapp → Location.</Text>\n",
    "<Text>Turn it on in settings → “Frapp” → location.</Text>\n",
    "<Text>Turn it on in settings → apps → Frapp → location.</Text>\n",
    'const m = "Turn it on in Settings → \\"Frapp\\" → Location.";\n',
  ]) {
    assert.deepEqual(settingsPathProblems([recovery(STUDY), { rel: PRIMER, source }], "Frapp"), [], source);
  }
  assert.deepEqual(settingsPathProblems([recovery(STUDY), recovery(PRIMER, "Signet")], "Frapp"), [lost]);
});

// One planted leftover per row, so emptying a row's bans or neutering its
// predicate fails here even while the live tree is clean.
test("every row reports its own planted leftover", () => {
  const signetLine = 'const t = "Signet";\n';
  for (const row of COPY_WALKS) {
    assert.deepEqual(copyProblems(row, [{ rel: "x.tsx", source: signetLine }]), ["x.tsx:1"], row.surface);
  }
  const textSamples = ["// Signet System\n", 'merchantDisplayName: "Signet"\n', "installed Signet build\n"];
  assert.equal(textSamples.length, TEXT_BANS.length);
  TEXT_BANS.forEach((row, i) => assert.equal(textBanProblems(row, [{ rel: "x", source: textSamples[i] }]).length, 1, String(row.ban)));
  const collectedSamples = {
    "mobile *Permission prompt": 'module.exports = { cameraPermission: "Allow the app to use the camera." };',
    "web auth title": "<AuthScreen title={'Signet'} />",
    "web auth subtitle": '<AuthScreen subtitle="Ask Signet anything." />',
    "web metadata title": "export const metadata = {\n  title: 'Tasks · Frapp'\n}",
    "landing metadata title": "export const metadata = {\n  title: 'Signet — Privacy',\n};",
  };
  for (const row of COLLECTED) {
    assert.ok(row.what in collectedSamples, `no planted sample for ${row.what}`);
    const found = collectedProblems(row, [{ rel: "x", source: collectedSamples[row.what] }]).filter((problem) => problem.startsWith("x:"));
    assert.equal(found.length, 1, row.what);
  }
});

// The binary's EAS project id is mobile-permanent-identifiers' and
// eas-production-profile's; this lock must not come to require it.
test("never requires extra.eas.projectId", () => {
  assert.doesNotMatch(readFileSync(fileURLToPath(import.meta.url), "utf8"), /assert\.[^\n]*extra\.eas\.projectId/);
});

test("refuses a GitHub closer next to an issue number", () => {
  assert.doesNotMatch(
    readFileSync(fileURLToPath(import.meta.url), "utf8"),
    /\b(fixes|closes|close|fix|fixed|resolve|resolves|resolved)\s+#/i,
  );
});
