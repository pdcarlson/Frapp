// Locks customer-facing CSV/PDF download filenames on Signet.
//
// WHY THIS EXISTS. Leftover 1937 renames the browser Save-as prefix from
// frapp- to signet-. Those strings sit next to storage object keys that
// must stay unprefixed (`${kind}-${day}-${uuid}.pdf`) and next to
// identifiers that must stay Frapp (`frapp://`, bundle ids). A later
// leftover sweep can flip the wrong token, or a merge can put
// `frapp-${kind}` back, without a product-copy test noticing. The first
// lock only named the two known templates; a third `frapp-*.csv` /
// `frapp-*.pdf` download site would have passed.
//
// SCOPE. Download filename templates and a walk of apps/{web,api,mobile}
// for leftover frapp- CSV/PDF names. Do not assert storage paths, OpenAPI
// title (1930), calendar ICS PRODID / `frapp-event` fallbacks (1929), or
// the unprefixed API CSV `filename="${kind}-report.csv"`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const SITES = [
  {
    rel: "apps/web/lib/utils.ts",
    wanted: "`signet-${filenamePrefix}-",
    banned: "`frapp-${filenamePrefix}-",
  },
  {
    rel: "apps/api/src/application/services/report-export.service.ts",
    wanted: "`signet-${kind}-report-",
    banned: "`frapp-${kind}-report-",
  },
];

const APP_ROOTS = ["apps/web", "apps/api", "apps/mobile"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".next", "coverage"]);
const SOURCE_EXT = /\.(?:ts|tsx|js|mjs)$/;

// Save-as / Content-Disposition names that still start with frapp- and
// end in csv/pdf. Template, comment, and fixture spellings all count.
export const FRAPP_DOWNLOAD_NAME =
  /frapp-(?:\$\{[^}\n]+\}|<[^>\n]+>|[A-Za-z0-9_-]+)[^`'"\n]{0,120}\.(csv|pdf)/i;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readRepo(rel) {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

export function walkAppSources(root = REPO_ROOT) {
  const files = [];
  const walk = (relDir) => {
    for (const entry of readdirSync(join(root, relDir), { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const rel = `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(rel);
        continue;
      }
      if (SOURCE_EXT.test(entry.name)) files.push(rel);
    }
  };
  for (const appRoot of APP_ROOTS) walk(appRoot);
  return files.sort();
}

export function frappDownloadFilenameProblems(files) {
  const problems = [];
  for (const { rel, source } of files) {
    for (const [index, line] of source.split("\n").entries()) {
      if (FRAPP_DOWNLOAD_NAME.test(line)) {
        problems.push(`${rel}:${index + 1}`);
      }
    }
  }
  return problems;
}

function liveAppSources() {
  return walkAppSources().map((rel) => ({ rel, source: readRepo(rel) }));
}

test("CSV and PDF download filenames ship signet-, not frapp-", () => {
  for (const site of SITES) {
    const source = readRepo(site.rel);
    assert.match(source, new RegExp(escapeRegExp(site.wanted)), site.rel);
    assert.doesNotMatch(
      source,
      new RegExp(escapeRegExp(site.banned)),
      `${site.rel} must not keep ${site.banned}`,
    );
  }
});

test("apps/{web,api,mobile} have no leftover frapp- CSV/PDF download names", () => {
  assert.deepEqual(frappDownloadFilenameProblems(liveAppSources()), []);
});

test("a third frapp- CSV download site fails the walk", () => {
  const problems = frappDownloadFilenameProblems([
    {
      rel: "apps/web/lib/new-export.ts",
      source: "downloadBlob(blob, `frapp-export-${day}.csv`);\n",
    },
  ]);
  assert.deepEqual(problems, ["apps/web/lib/new-export.ts:1"]);
});

test("putting frapp- back on downloadCsv fails the walk", () => {
  const rel = "apps/web/lib/utils.ts";
  const source = readRepo(rel).replaceAll(
    "`signet-${filenamePrefix}-",
    "`frapp-${filenamePrefix}-",
  );
  const problems = frappDownloadFilenameProblems([{ rel, source }]);
  assert.ok(
    problems.some((problem) => problem.startsWith(`${rel}:`)),
    problems.join("; "),
  );
});

test("putting frapp- back on the report PDF filename fails the walk", () => {
  const rel = "apps/api/src/application/services/report-export.service.ts";
  const source = readRepo(rel).replaceAll(
    "`signet-${kind}-report-",
    "`frapp-${kind}-report-",
  );
  const problems = frappDownloadFilenameProblems([{ rel, source }]);
  assert.ok(
    problems.some((problem) => problem.startsWith(`${rel}:`)),
    problems.join("; "),
  );
});

test("unprefixed API CSV and ICS fallbacks are not this leftover", () => {
  assert.deepEqual(
    frappDownloadFilenameProblems([
      {
        rel: "apps/api/src/interface/controllers/report.controller.ts",
        source: 'res.setHeader("Content-Disposition", `attachment; filename="${kind}-report.csv"`);\n',
      },
      {
        rel: "apps/mobile/lib/calendar-export.ts",
        source: 'const filename = `${slug || "frapp-event"}.ics`;\n',
      },
    ]),
    [],
  );
});

test("refuses a GitHub closer next to an issue number", () => {
  const lock = readFileSync(fileURLToPath(import.meta.url), "utf8");
  assert.doesNotMatch(
    lock,
    /\b(fixes|closes|close|fix|fixed|resolve|resolves|resolved)\s+#/i,
  );
});
