import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The product source of both Next surfaces, for the call-site scans that ban a
 * class shape everywhere it could ship (`components/shared/status-tint-call-sites`
 * and `components/shared/elevation-call-sites`).
 *
 * One copy, for the reason `signet-contrast.ts` keeps one seed corpus: two scans
 * that each owned a `ROOTS` list could drift, and a root added to one would
 * silently fall out of the other's ban. (`lib/date-call-sites.spec.ts` keeps
 * its own walker: it scans `apps/web` alone, with a narrower comment stripper,
 * so folding it in would change what that guard reads.)
 */

/** The repo root, from `apps/web/tests/`. */
export const REPO = join(__dirname, "..", "..", "..");

/** Where product code lives in each Next app; `tests/` is harness code. */
export const ROOTS = [
  "apps/web/app",
  "apps/web/components",
  "apps/web/hooks",
  "apps/web/lib",
  "apps/landing/app",
  "apps/landing/components",
  "apps/landing/lib",
] as const;

const TS_SOURCE = /\.tsx?$/;
const SPEC = /\.(spec|test)\.tsx?$/;

/**
 * `withFileTypes`, as in `lib/date-call-sites.spec.ts`, so a dangling symlink
 * is skipped rather than crashing the suite. A root that stops existing throws
 * instead of being skipped, because a scan of nothing passes forever.
 */
function walk(dir: string, source: RegExp): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      found.push(...walk(path, source));
    } else if (entry.isFile() && source.test(entry.name)) {
      if (!SPEC.test(entry.name)) found.push(path);
    }
  }
  return found;
}

/** Every non-spec file under `ROOTS` whose name matches `source` (TS by default). */
export function productSourceFiles(source: RegExp = TS_SOURCE): string[] {
  return ROOTS.flatMap((root) => walk(join(REPO, root), source)).sort();
}

/**
 * Comments are dropped before matching: prose may name the banned shape to
 * explain why a line does not use it.
 */
export function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}
