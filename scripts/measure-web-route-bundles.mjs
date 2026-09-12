#!/usr/bin/env node
/**
 * Reports the client JavaScript each `apps/web` route makes a cold visitor
 * download and parse before it can paint.
 *
 * ## Why this measurement, and not a stopwatch
 *
 * The framework board's first-paint contract (`spec/ui/web-greenfield/reference/`,
 * section `1s`) is written in milliseconds: shell visible ≤ 200ms, cached channel
 * readable ≤ 400ms, composer focusable ≤ 400ms. Those are the right budgets and
 * the wrong assertion. A wall-clock number measured on a shared CI runner varies
 * with whatever else that runner is doing, so a gate built on one either flaps or
 * gets a margin so wide it catches nothing. And the existing Playwright harness
 * boots `next dev` against no session (`apps/web/tests/visual/README.md`), which
 * is neither a production bundle nor a populated route — its `/chat` renders "No
 * chapter selected".
 *
 * Entry JS bytes are the term those milliseconds are mostly made of, and they are
 * exact: the same commit produces the same number on any machine, so a reviewer
 * can reproduce it and a regression is unambiguous. That is what this reports.
 *
 * It is a **measurement, not a gate** — the same posture `npm run test:cov` has
 * (`AGENTS.md` § Lint, test, build, type-check). Nothing in CI runs it. Wiring a
 * budget into a required check is a decision about which routes get frozen at
 * what number, and this greenfield is mid-rebuild; freezing it now would pin
 * numbers that five open lanes are still moving.
 *
 * ## Where the numbers come from
 *
 * Next writes one `page_client-reference-manifest.js` per route under
 * `.next/server/app/**`. Each assigns `globalThis.__RSC_MANIFEST[route]`, whose
 * `entryJSFiles` maps every entry in the route's segment tree to the ordered list
 * of chunks the client loads for it. The route's own `…/page` key is the whole
 * initial payload: layout chunks, shared vendor chunks and the page's own.
 *
 * Both sizes are reported. Uncompressed on-disk bytes are what the browser parses,
 * and parse is the part that blocks paint. Gzipped is what the network spends, and
 * it is the unit `spec/ui/resilience/performance-budgets.md` writes its budgets in.
 * Gzip rather than Brotli because it is in Node's standard library, so the number
 * needs no toolchain and does not drift with a CDN's compression settings; Vercel
 * serves Brotli, which lands a further ~15% under this.
 *
 * A route's "own cost" is what it adds on top of the chunks every dashboard route
 * already loads — the shell floor. That split is the one the board's `1s` asks
 * about directly: "shell chunk: layout, nav, top bar, find" against everything a
 * route drags in behind it.
 *
 * Usage: `node scripts/measure-web-route-bundles.mjs [--json]`, after a build.
 */
import { readFileSync, statSync, existsSync } from "node:fs";
import { globSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NEXT_DIR = join(ROOT, "apps/web/.next");

/**
 * The manifest is executable JavaScript, not JSON: one assignment statement
 * whose right-hand side is an object literal that happens to be JSON-shaped.
 * Slicing at the first `=` after the `__RSC_MANIFEST[` key and parsing the rest
 * avoids both `eval` and a dependency on Next's internal module shape beyond
 * that one line, which has been stable across the versions this repo has run.
 */
function readManifest(path) {
  const source = readFileSync(path, "utf8");
  const keyAt = source.indexOf('__RSC_MANIFEST["');
  if (keyAt === -1) return null;
  const eq = source.indexOf("=", keyAt);
  if (eq === -1) return null;
  try {
    return JSON.parse(
      source
        .slice(eq + 1)
        .trim()
        .replace(/;$/, ""),
    );
  } catch {
    return null;
  }
}

function bytesOf(chunks) {
  let total = 0;
  for (const chunk of chunks) {
    const path = join(NEXT_DIR, chunk);
    if (existsSync(path)) total += statSync(path).size;
  }
  return total;
}

/**
 * Each chunk compressed on its own, then summed — not the concatenation
 * compressed once. That is what a browser actually receives: separate responses,
 * each with its own gzip window, so cross-file redundancy does not compress away.
 * Compressing them together would report a number no client ever downloads.
 */
const gzipCache = new Map();
function gzippedBytesOf(chunks) {
  let total = 0;
  for (const chunk of chunks) {
    if (!gzipCache.has(chunk)) {
      const path = join(NEXT_DIR, chunk);
      gzipCache.set(
        chunk,
        existsSync(path) ? gzipSync(readFileSync(path)).length : 0,
      );
    }
    total += gzipCache.get(chunk);
  }
  return total;
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

if (!existsSync(NEXT_DIR)) {
  console.error(
    `measure-web-route-bundles: no build at ${NEXT_DIR}.\n` +
      "Run `npm run build -w apps/web` first — this reads the emitted chunks, so a\n" +
      "stale or missing build reports stale or no numbers.",
  );
  process.exit(1);
}

/**
 * Keyed by entry, not pushed per manifest. A route's manifest carries its
 * ancestors' entries too, so `app/page` turns up in both its own manifest and
 * the `(dashboard)` group's — listing it twice would read as two routes with
 * identical numbers.
 */
const byEntry = new Map();
// `fs.globSync` resolves matches against `cwd` but returns them relative to it,
// so the join is not optional.
for (const match of globSync(
  "server/app/**/page_client-reference-manifest.js",
  {
    cwd: NEXT_DIR,
  },
)) {
  const manifest = readManifest(join(NEXT_DIR, match));
  const entries = manifest?.entryJSFiles;
  if (!entries) continue;
  for (const [entry, chunks] of Object.entries(entries)) {
    // Every route's manifest also carries the entries of its ancestors (the root
    // layout, the group layout). Only the `…/page` key is this route's own total.
    if (!entry.endsWith("/page")) continue;
    const route =
      entry
        .replace("[project]/apps/web/app", "")
        .replace(/\/page$/, "")
        // Route groups are a source-tree device; they are not in the URL.
        .replace(/\/\([^)]*\)/g, "") || "/";
    if (!byEntry.has(entry)) {
      byEntry.set(entry, { route, chunks });
    }
  }
}

const routes = [...byEntry.values()];

if (routes.length === 0) {
  console.error(
    "measure-web-route-bundles: the build produced no route manifests.\n" +
      "That usually means the build failed partway, or Next changed where it writes them.",
  );
  process.exit(1);
}

routes.sort((a, b) => b.bytes - a.bytes);

/**
 * The shell floor: chunks that appear on **every** dashboard route, so no route
 * can avoid them. Intersected rather than taken from one route's layout entry,
 * because a chunk is only unavoidable if it is genuinely on all of them — a
 * vendor chunk that four routes happen to share is the fifth route's own cost,
 * not the shell's.
 */
const dashboard = routes.filter(
  (r) =>
    r.route !== "/" &&
    !["/sign-in", "/sign-up", "/join", "/no-access", "/dashboard"].includes(
      r.route,
    ),
);
const shared = dashboard.length
  ? dashboard
      .map((r) => new Set(r.chunks))
      .reduce((acc, set) => new Set([...acc].filter((c) => set.has(c))))
  : new Set();
const floor = bytesOf([...shared]);
const floorGzip = gzippedBytesOf([...shared]);

const rows = routes.map((r) => {
  const own = r.chunks.filter((c) => !shared.has(c));
  return {
    route: r.route,
    chunks: r.chunks.length,
    bytes: bytesOf(r.chunks),
    gzipBytes: gzippedBytesOf(r.chunks),
    ownBytes: bytesOf(own),
    ownGzipBytes: gzippedBytesOf(own),
  };
});
rows.sort((a, b) => b.bytes - a.bytes);

if (process.argv.includes("--json")) {
  console.log(
    JSON.stringify(
      { shellFloorBytes: floor, shellFloorGzipBytes: floorGzip, routes: rows },
      null,
      2,
    ),
  );
} else {
  console.log(
    `Shell floor (chunks on every dashboard route): ${kb(floor)} ` +
      `(${kb(floorGzip)} gzipped)\n`,
  );
  console.log("  entry JS     gzipped   own cost    gzipped  chunks  route");
  for (const row of rows) {
    console.log(
      `${kb(row.bytes).padStart(10)} ${kb(row.gzipBytes).padStart(11)} ` +
        `${kb(row.ownBytes).padStart(10)} ${kb(row.ownGzipBytes).padStart(10)} ` +
        `${String(row.chunks).padStart(7)}  ${row.route}`,
    );
  }
  console.log(
    "\n`own cost` excludes the shell floor above. Budgets:\n" +
      "spec/ui/resilience/performance-budgets.md, and board `1s` — shell visible\n" +
      "200ms, cached channel readable 400ms, composer focusable 400ms.",
  );
}
