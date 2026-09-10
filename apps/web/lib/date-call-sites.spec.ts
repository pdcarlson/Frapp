import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `@repo/formatting` owns date display on this surface. This is the guard that
 * keeps it owning it.
 *
 * The value-level specs in `packages/formatting` prove each member is correct;
 * none of them can see a *call site* that reaches the wrong member. #1641 is
 * what that gap costs. Two shapes shipped the same defect:
 *
 * 1. **Hand-rolled** — `new Date(value).toLocaleDateString()`, bypassing the
 *    package entirely.
 * 2. **Right package, wrong member** — `formatLocaleDate(bareDateColumn)`,
 *    which is the *same* `new Date(value)` parse behind a blessed, lint-clean
 *    import. This is the more dangerous shape, and the first draft of this
 *    guard could not see it: it was green with three live wrong-day renders
 *    in the tree.
 *
 * Both matter because a bare `YYYY-MM-DD` read through `new Date` is UTC
 * midnight, which renders the *previous* calendar day west of Greenwich. The
 * package has carried that rule in a docstring since it was written
 * (`packages/formatting/src/bare-date.ts`), and a docstring is not a gate —
 * two call sites had already chosen wrong by the time this was written.
 *
 * A walk rather than a file ledger, deliberately: the defect this catches is a
 * *new* file written from the habit, and a ledger only covers files somebody
 * remembered to add.
 */

const ROOT = join(__dirname, "..");

/** Where product code lives. `tests/` is harness code and formats freely. */
const SOURCE_DIRS = ["app", "components", "hooks", "lib"] as const;

const SOURCE_FILE = /\.tsx?$/;
const IS_SPEC = /\.(spec|test)\.tsx?$/;

/**
 * `withFileTypes` so a dangling symlink is classified from the directory entry
 * instead of crashing the suite on `statSync`'s `ENOENT` — a stale editor swap
 * link under `components/` would otherwise fail every PR with an error naming
 * neither dates nor this file.
 */
function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      found.push(...sourceFiles(path));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SOURCE_FILE.test(entry.name) || IS_SPEC.test(entry.name)) continue;
    found.push(path);
  }
  return found;
}

/**
 * Comments stripped first — this file's own prose quotes the banned calls, and
 * the production files that document *why* they format the way they do name
 * them too. A guard that fails on its own explanation is a guard nobody keeps.
 * Same stripper `components/profile/family-call-sites.spec.ts` uses.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Rule 1 — `new Date(…).toLocaleDateString()` / `.toLocaleString()` /
 * `.toLocaleTimeString()` with **no arguments**: the shape that duplicates a
 * `@repo/formatting` member exactly.
 *
 * An explicit options bag (`toLocaleDateString(undefined, { month: "short" })`)
 * is deliberately *not* matched: those render a format no member offers, and
 * banning them would push a caller into a worse workaround than the one this
 * exists to prevent.
 */
const HAND_ROLLED =
  /new Date\((?:[^()]|\([^()]*\))*\)\s*\.\s*toLocale(?:Date|Time)?String\(\s*\)/;

/**
 * Rule 2 — the columns that are `date` in Postgres, not `timestamptz`. Read
 * one of these through `formatLocaleDate` and the rendered day is wrong west
 * of Greenwich; `formatBareDate` is the member that gets it right.
 *
 * A ledger, because nothing in the TypeScript types distinguishes the two — a
 * `date` column and a `timestamptz` column are both `string` by the time they
 * reach a component, which is the whole reason this defect is invisible.
 *
 * | Column | Table | Declared |
 * | --- | --- | --- |
 * | `due_date` | `financial_invoices` | `initial_schema.sql:356` |
 * | `due_date` | `tasks` | `initial_schema.sql:407` |
 * | `effective_date` | `chapter_documents` | `20260831220000_chapter_documents_metadata.sql:24` |
 */
const BARE_DATE_COLUMNS = ["due_date", "effective_date"] as const;

/**
 * Resolves what `formatLocaleDate` is called locally in a file — both call
 * sites that shipped the bug imported it as `formatLocaleDate as formatDate`,
 * so a rule keyed on the exported name would have matched neither.
 */
function localNameForFormatLocaleDate(source: string): string | null {
  // `[^{}]` and not `[\s\S]*?`: a lazy match still *starts* at the first
  // `import {` in the file and runs to the first `} from "@repo/formatting"`,
  // swallowing every import in between — so the clause split then sees
  // `import { formatLocaleDate` rather than `formatLocaleDate`, and the rule
  // silently resolves nothing. That draft was green against both files that
  // had actually shipped the bug.
  const imports = source.matchAll(
    /import\s*\{([^{}]*)\}\s*from\s*["']@repo\/formatting["']/g,
  );
  for (const block of imports) {
    for (const clause of (block[1] ?? "").split(",")) {
      const [exported, alias] = clause.split(/\bas\b/).map((s) => s.trim());
      if (exported === "formatLocaleDate") return alias || exported;
    }
  }
  return null;
}

function wrongMemberCalls(source: string): string[] {
  const local = localNameForFormatLocaleDate(source);
  if (!local) return [];
  const call = new RegExp(
    `\\b${local}\\(\\s*[^)]*\\b(?:${BARE_DATE_COLUMNS.join("|")})\\b[^)]*\\)`,
    "g",
  );
  return source.match(call) ?? [];
}

describe("date display goes through the right @repo/formatting member", () => {
  const files = SOURCE_DIRS.flatMap((dir) => sourceFiles(join(ROOT, dir)));

  it("finds the source tree it is supposed to be walking", () => {
    // A walk that silently matches nothing is a green test proving nothing.
    // The floor is deliberately far below the real count (~210 at the time of
    // writing) so ordinary consolidation does not turn it red.
    expect(files.length).toBeGreaterThan(100);
  });

  it("no production file hand-rolls a locale date string", () => {
    const offenders = files
      .filter((path) => HAND_ROLLED.test(code(path)))
      .map((path) => path.slice(ROOT.length + 1));

    expect(offenders).toEqual([]);
  });

  it("no production file reads a bare `date` column through formatLocaleDate", () => {
    const offenders = files
      .flatMap((path) =>
        wrongMemberCalls(code(path)).map(
          (call) => `${path.slice(ROOT.length + 1)}: ${call}`,
        ),
      )
      .sort();

    expect(offenders).toEqual([]);
  });

  it("both rules can actually fail", () => {
    // Rule 1 — the exact strings that were in the tree.
    for (const shipped of [
      "{new Date(invoice.due_date).toLocaleDateString()}",
      "Uploaded {new Date(doc.created_at).toLocaleDateString()}",
      "` · Effective ${new Date(doc.effective_date).toLocaleDateString()}`",
      "{new Date(live.created_at).toLocaleString()}",
      "? new Date(row.start_time).toLocaleString()",
    ]) {
      expect(HAND_ROLLED.test(shipped)).toBe(true);
    }

    // …and the shapes rule 1 must leave alone.
    for (const allowed of [
      'start.toLocaleDateString(undefined, { month: "short" })',
      "formatBareDate(invoice.due_date)",
      "`Capped at ${truncation.rowLimit.toLocaleString()} rows.`",
    ]) {
      expect(HAND_ROLLED.test(allowed)).toBe(false);
    }

    // Rule 2 — through the alias both offending files actually used, which is
    // the form the first draft of this guard was blind to.
    // Preceded by other `import { … }` statements on purpose: both offending
    // files import from "react" and "@repo/hooks" first, and the draft that
    // matched across them resolved no alias at all and passed on both.
    const aliased = `
      import { useMemo, useState } from "react";
      import { useTasks, useCreateTask } from "@repo/hooks";
      import { formatLocaleDate as formatDate } from "@repo/formatting";
      <span>Due {formatDate(task.due_date)}</span>
    `;
    expect(wrongMemberCalls(aliased)).toEqual(["formatDate(task.due_date)"]);

    // …and through the un-aliased name.
    const direct = `
      import { formatLocaleDate } from "@repo/formatting";
      formatLocaleDate(doc.effective_date)
    `;
    expect(wrongMemberCalls(direct)).toEqual([
      "formatLocaleDate(doc.effective_date)",
    ]);

    // Rule 2 must not fire on the correct member, nor on a timestamptz column.
    const correct = `
      import { formatBareDate as formatDate, formatLocaleDate } from "@repo/formatting";
      formatDate(invoice.due_date);
      formatLocaleDate(doc.created_at);
    `;
    expect(wrongMemberCalls(correct)).toEqual([]);
  });
});
