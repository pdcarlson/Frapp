// Locks what the API says to a person on Frapp, never Signet.
//
// WHY THIS EXISTS. ADR-25 names the product Frapp, and step 3 moved the
// server off "Signet": error messages, the report PDF (producer, creator,
// footer) and its download name, the ICS PRODID, and the OpenAPI text. Step
// 4 moved the Discord error messages, with the web import screens they appear
// on. The invite email, the OpenAPI title, the system actor and the Auth
// conformance constants keep their own locks (frapp-invite-from, frapp-public-title,
// frapp-system-display-name, frapp-smtp-sender-name, frapp-mailer-subjects).
// The walk here is what makes those pinned sites not the whole story: a new
// error message that says Signet fails without anyone listing it.
//
// WHAT IT CHECKS.
// - A walk of apps/api/src's non-spec .ts files and the committed
//   openapi.json: no whole word "Signet" and no signet- download filename
//   outside the comment a line starts with (the note on LINE_BREAK in
//   ../lib/copy-lines.mjs says why). One thing passes, DESIGN_SYSTEM_PHRASE.
//   "Signet" stays the design system's name until the internals series after
//   the beta, and the palette engine's server log lines name its accent
//   ("Signet accent contrast below AA"). Only that phrase passes. The OpenAPI
//   descriptions of the same checks say "accent role" and "design system §8"
//   instead, because /docs is public; the `--signet-*` role names in them are
//   identifiers, not the word. The three Discord files were exempt until
//   step 4 renamed them.
// - The report PDF filename and the ICS PRODID, pinned by value. A rename
//   that dropped the brand altogether would pass the walk. The Jest specs
//   assert the same values, but only this ratchet runs without `npm ci`.
//
// SCOPE. apps/api only. Identifiers are not copy and stay: the
// `signet_role_key` field, the `--signet-*` roles, `SIGNET_ENGINE_VERSION`,
// and the @frapp.live ICS UID host (ics-uid-host keeps that).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { copyMatches } from "../lib/copy-lines.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const API_SRC = join(REPO_ROOT, "apps/api/src");
const OPENAPI = "apps/api/openapi.json";
const REPORT_EXPORT = "apps/api/src/application/services/report-export.service.ts";
const EVENT_SERVICE = "apps/api/src/application/services/event.service.ts";

const REPORT_FILENAME = "`frapp-${kind}-report-";
const PRODID = "PRODID:-//Frapp//Events//EN";

/** Where a design-system "Signet" starts: the palette engine's accent log lines. */
export const DESIGN_SYSTEM_PHRASE = /^Signet accent (?:contrast|fill)\b/;

const SIGNET_DOWNLOAD_NAME = /\bsignet-[\w-]*(?=[^\n]{0,80}?\.(?:ics|csv|pdf)\b)/gi;

function readRepo(rel) {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

function relOf(path) {
  return relative(REPO_ROOT, path).replaceAll("\\", "/");
}

function walkApiSource(dir = API_SRC) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkApiSource(path));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts") && !/\.spec\.ts$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

function liveFiles() {
  const files = walkApiSource().map((path) => ({ rel: relOf(path), source: readFileSync(path, "utf8") }));
  files.push({ rel: OPENAPI, source: readRepo(OPENAPI) });
  return files;
}

export function signetCopyProblems(files) {
  return copyMatches(files, /\bSignet\b/g)
    .filter(({ text, match }) => !DESIGN_SYSTEM_PHRASE.test(text.slice(match.index)))
    .map(({ rel, line }) => `${rel}:${line}`);
}

export function signetDownloadNameProblems(files) {
  return copyMatches(files, SIGNET_DOWNLOAD_NAME).map(({ rel, line }) => `${rel}:${line}`);
}

export function pinnedSiteProblems({ reportExport, eventService }) {
  const problems = [];
  if (!reportExport.includes(REPORT_FILENAME)) {
    problems.push(`${REPORT_EXPORT} must name the download ${REPORT_FILENAME}`);
  }
  if (!eventService.includes(PRODID)) {
    problems.push(`${EVENT_SERVICE} must ship ${PRODID}`);
  }
  return problems;
}

test("the API says Frapp, never Signet", () => {
  const files = liveFiles();
  assert.ok(files.some((file) => file.rel === "apps/api/src/main.ts"), "walk must reach main.ts");
  assert.ok(files.some((file) => file.rel === REPORT_EXPORT), "walk must reach the report export");
  assert.deepEqual(signetCopyProblems(files), []);
  assert.deepEqual(signetDownloadNameProblems(files), []);
  assert.deepEqual(
    pinnedSiteProblems({
      reportExport: readRepo(REPORT_EXPORT),
      eventService: readRepo(EVENT_SERVICE),
    }),
    [],
  );
});

test("a Signet error message or OpenAPI description fails the walk", () => {
  const problems = signetCopyProblems([
    {
      rel: "apps/api/src/application/services/attendance.service.ts",
      source: "throw new BadRequestException(\n  'use the Signet mobile app to check in.',\n);\n",
    },
    { rel: OPENAPI, source: '{\n  "summary": "Map each Discord channel onto a Signet channel"\n}\n' },
    { rel: "apps/api/src/main.ts", source: "Logger.log(`Signet API running on ${port}`);\n" },
  ]);
  assert.deepEqual(problems, [
    "apps/api/src/application/services/attendance.service.ts:2",
    `${OPENAPI}:2`,
    "apps/api/src/main.ts:1",
  ]);
});

test("design-system phrases and comments pass; the product name after them does not", () => {
  const rel = "apps/api/src/application/services/chapter-palette.ts";
  assert.deepEqual(
    signetCopyProblems([
      {
        rel,
        source: [
          "logger.warn(`Signet accent contrast below AA ${where}`);",
          "logger.warn(`Signet accent fill below 3:1 ${where}`);",
          "// Signet is the design system; this comment is not copy.",
          " * The Signet accent engine derives every role.",
        ].join("\n"),
      },
    ]),
    [],
  );
  assert.deepEqual(
    signetCopyProblems([
      {
        rel,
        source: [
          "const a = 'Signet accent';",
          "const b = 'Signet support will reply';",
          "description: 'Signet §8 contrast checks below AA for this save.',",
          "description: 'The Signet role that failed.',",
        ].join("\n"),
      },
    ]),
    [`${rel}:1`, `${rel}:2`, `${rel}:3`, `${rel}:4`],
  );
});

test("a Signet Discord error message fails like any other", () => {
  const source = "throw new Error('Signet could not read that Discord server.');\n";
  for (const rel of [
    "apps/api/src/application/services/discord-import.service.ts",
    "apps/api/src/domain/utils/discord-api-message.ts",
    "apps/api/src/infrastructure/discord/discord-bot-gateway.service.ts",
  ]) {
    assert.deepEqual(signetCopyProblems([{ rel, source }]), [`${rel}:1`]);
  }
});

test("putting signet- back on the report PDF or Signet on the PRODID fails", () => {
  const reportExport = readRepo(REPORT_EXPORT).replace("`frapp-${kind}-report-", "`signet-${kind}-report-");
  const eventService = readRepo(EVENT_SERVICE).replace(PRODID, "PRODID:-//Signet//Events//EN");
  assert.deepEqual(pinnedSiteProblems({ reportExport, eventService }), [
    `${REPORT_EXPORT} must name the download ${REPORT_FILENAME}`,
    `${EVENT_SERVICE} must ship ${PRODID}`,
  ]);
  assert.deepEqual(signetDownloadNameProblems([{ rel: REPORT_EXPORT, source: reportExport }]).length, 1);
  assert.deepEqual(signetCopyProblems([{ rel: EVENT_SERVICE, source: eventService }]).length, 1);
});

test("dropping the brand from the report PDF name fails the pin", () => {
  const reportExport = readRepo(REPORT_EXPORT).replace("`frapp-${kind}-report-", "`${kind}-report-");
  assert.deepEqual(
    pinnedSiteProblems({ reportExport, eventService: readRepo(EVENT_SERVICE) }),
    [`${REPORT_EXPORT} must name the download ${REPORT_FILENAME}`],
  );
});

test("refuses a GitHub closer next to an issue number", () => {
  const lock = readFileSync(fileURLToPath(import.meta.url), "utf8");
  assert.doesNotMatch(
    lock,
    /\b(fixes|closes|close|fix|fixed|resolve|resolves|resolved)\s+#/i,
  );
});
