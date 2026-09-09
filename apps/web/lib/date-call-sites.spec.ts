import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `@repo/formatting` owns date display on this surface. This is the guard that
 * keeps it owning it.
 *
 * The value-level specs in `packages/formatting` prove each member is correct;
 * none of them can see a *call site* that never reaches a member. #1641 is what
 * that gap costs: five surfaces here hand-rolled
 * `new Date(value).toLocaleDateString()`, and two of them read bare `date`
 * columns (`invoices.due_date`, `chapter_documents.effective_date`), which
 * `new Date` reads as UTC midnight — so every user west of Greenwich was shown
 * the *previous* calendar day. The package had carried the rule in a docstring
 * since it was written (`packages/formatting/src/bare-date.ts`: "Do not fold
 * either into `formatLocaleDate` / `new Date(value)`"), and a docstring is not
 * a gate.
 *
 * A walk rather than a file ledger, deliberately: the defect this catches is a
 * *new* file written from the habit, and a ledger only ever covers files
 * somebody remembered to add.
 */

const ROOT = join(__dirname, "..");

/** Where product code lives. `tests/` is harness code and formats freely. */
const SOURCE_DIRS = ["app", "components", "hooks", "lib"] as const;

const SOURCE_FILE = /\.tsx?$/;
const IS_SPEC = /\.(spec|test)\.tsx?$/;

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      found.push(...sourceFiles(path));
      continue;
    }
    if (!SOURCE_FILE.test(entry) || IS_SPEC.test(entry)) continue;
    found.push(path);
  }
  return found;
}

/**
 * Comments stripped first — this file's own prose quotes the banned call, and
 * the four production files that document *why* they format the way they do
 * name it too. A guard that fails on its own explanation is a guard nobody
 * keeps.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * `new Date(…).toLocaleDateString()` / `.toLocaleString()` /
 * `.toLocaleTimeString()` with **no arguments** — the shape that duplicates a
 * `@repo/formatting` member exactly.
 *
 * An explicit options bag (`toLocaleDateString(undefined, { month: "short" })`)
 * is deliberately *not* matched: those render a format no member offers, and
 * banning them would push a caller into a worse workaround than the one this
 * exists to prevent.
 */
const HAND_ROLLED =
  /new Date\((?:[^()]|\([^()]*\))*\)\s*\.\s*toLocale(?:Date|Time)?String\(\s*\)/;

describe("date display goes through @repo/formatting", () => {
  const files = SOURCE_DIRS.flatMap((dir) => sourceFiles(join(ROOT, dir)));

  it("finds the source tree it is supposed to be walking", () => {
    // A walk that silently matches nothing is a green test that proves nothing.
    expect(files.length).toBeGreaterThan(200);
  });

  it("no production file hand-rolls a locale date string", () => {
    const offenders = files
      .filter((path) => HAND_ROLLED.test(code(path)))
      .map((path) => path.slice(ROOT.length + 1));

    expect(offenders).toEqual([]);
  });

  it("would catch the call sites #1641 removed", () => {
    // Proof the pattern can fail: the exact strings that were in the tree.
    for (const shipped of [
      "{new Date(invoice.due_date).toLocaleDateString()}",
      "Uploaded {new Date(doc.created_at).toLocaleDateString()}",
      "` · Effective ${new Date(doc.effective_date).toLocaleDateString()}`",
      "{new Date(live.created_at).toLocaleString()}",
      "? new Date(row.start_time).toLocaleString()",
    ]) {
      expect(HAND_ROLLED.test(shipped)).toBe(true);
    }

    // And the shapes it must leave alone.
    for (const allowed of [
      'start.toLocaleDateString(undefined, { month: "short" })',
      "formatBareDate(invoice.due_date)",
      "`Capped at ${truncation.rowLimit.toLocaleString()} rows.`",
    ]) {
      expect(HAND_ROLLED.test(allowed)).toBe(false);
    }
  });
});
