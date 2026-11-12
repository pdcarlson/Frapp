#!/usr/bin/env node
// Create a migration, or move a branch's migrations after everything on main.
//
//   npm run migration:new -- <snake_case_name>
//   npm run migration:renumber [-- --dry-run] [-- --base origin/main]
//
// Why this exists. Many sessions write migrations at once, and the version is
// picked when the file is written while the order is decided when PRs merge.
// Hand-picked "next hour" versions collided (two PRs at `…150000`), and a real
// timestamp goes stale the moment a later one merges first, which
// `migration-order` refuses (every new migration must sort after everything on
// the base branch). `new` writes a version after both the clock and main, and
// `renumber` is the one-command fix when main moves past a branch's migration:
// it renames the branch's own migrations (and their ledger pages) to fresh
// versions, in their original order, and rewrites references in the files the
// branch changed.
//
// Only ever renumber migrations that no hosted database has applied. Staging and
// production apply from main, so a branch's own migrations are unapplied unless
// someone applied one by hand; renaming one of those leaves a ledger row no file
// explains, and every later `db push` there refuses.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isInvokedDirectly } from "./ci/lib/invoked-directly.mjs";
import { MIGRATION_LEDGER_DIR } from "./ci/lib/ops-docs.mjs";

// Kept in step with LEDGER_PAGE_PLACEHOLDER in check-migration-safety.mjs (a test pins it):
// the gate refuses a page that still carries it.
export const PLACEHOLDER = "TODO(migration:new)";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const MIGRATIONS = "supabase/migrations";
const MIGRATION_FILE = /^(\d{14})_([a-z0-9_]+)\.sql$/;
const NAME = /^[a-z0-9_]+$/;

const pad = (n, w = 2) => String(n).padStart(w, "0");

/** A 14-digit UTC version for a Date. */
export function versionOf(date) {
  return (
    `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  );
}

/**
 * The version one second after `version`. Hand-picked versions such as
 * `20261112250000` (hour 25) are not real times; Date.UTC rolls them over, and
 * the result still sorts after the input, which is all ordering needs.
 */
export function nextVersion(version) {
  const ms = Date.UTC(
    Number(version.slice(0, 4)),
    Number(version.slice(4, 6)) - 1,
    Number(version.slice(6, 8)),
    Number(version.slice(8, 10)),
    Number(version.slice(10, 12)),
    Number(version.slice(12, 14)),
  );
  const next = versionOf(new Date(ms + 1000));
  return next > version ? next : String(BigInt(version) + 1n).padStart(14, "0");
}

/**
 * `text` with each renamed migration's stem (`<version>_<name>`) replaced, in one
 * pass, so one rename's new name can never be rewritten again by another. Bare
 * versions are left alone: a bare `…150000` may be main's migration of the same
 * version. `stale` lists the bare old versions still present, for a person to check.
 */
export function rewriteReferences(text, renames) {
  const map = new Map(renames.map(({ from, to }) => [from.slice(0, -4), to.slice(0, -4)]));
  let next = text;
  if (map.size > 0) {
    const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // The lookahead keeps `…_a` from matching inside main's `…_ab`.
    const pattern = new RegExp(
      `(?:${[...map.keys()].sort((a, b) => b.length - a.length).map(escape).join("|")})(?![a-z0-9_])`,
      "g",
    );
    next = text.replace(pattern, (stem) => map.get(stem));
  }
  const stale = [...new Set(renames.map(({ from }) => from.slice(0, 14)))].filter((v) =>
    next.includes(v),
  );
  return { text: next, stale };
}

/** The first version after every version in `taken`, and no earlier than `now`. */
export function freshVersion(taken, now = new Date()) {
  const clock = versionOf(now);
  const newest = [...taken].sort().at(-1);
  if (!newest) return clock;
  const after = nextVersion(newest);
  return after > clock ? after : clock;
}

/**
 * The renames that put a branch's migrations after the base branch's.
 *
 * @param {string[]} introduced filenames the branch adds (absent on the base and the merge base)
 * @param {string[]} base filenames on the base branch
 * @returns {Array<{ from: string, to: string }>} empty when every introduced
 *   migration already sorts after the base's newest and no two share a version.
 *   Otherwise every introduced migration moves, in its original order, so the
 *   branch's own migrations keep their relative order.
 */
export function planRenames(introduced, base, now = new Date()) {
  const baseVersions = base.map((f) => f.slice(0, 14));
  const floor = [...baseVersions].sort().at(-1) ?? "";
  const mine = [...introduced].sort();
  const versions = mine.map((f) => f.slice(0, 14));
  const clean =
    versions.every((v) => v > floor) && new Set(versions).size === versions.length;
  if (clean) return [];

  const renames = [];
  let version = freshVersion(baseVersions, now);
  for (const from of mine) {
    const to = `${version}${from.slice(14)}`;
    if (to !== from) renames.push({ from, to });
    version = nextVersion(version);
  }
  return renames;
}

function git(args, options = {}) {
  const out = execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", ...options });
  return (out ?? "").trim();
}

function migrationsAt(ref) {
  return git(["ls-tree", "--name-only", `${ref}:${MIGRATIONS}`])
    .split("\n")
    .filter((f) => MIGRATION_FILE.test(f));
}

function migrationsOnDisk() {
  return readdirSync(join(REPO_ROOT, MIGRATIONS)).filter((f) => MIGRATION_FILE.test(f));
}

function getArg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

function fetchBase(base) {
  const [remote, ...rest] = base.split("/");
  if (rest.length === 0) return;
  try {
    git(["fetch", "--quiet", remote, rest.join("/")], { stdio: "ignore" });
  } catch {
    console.warn(`Could not fetch ${base}; using the local ref.`);
  }
}

function ledgerTemplate(file) {
  return `# ${file}

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

${PLACEHOLDER} What it changes, in a sentence, and the issue it is for (#N).

## Promotion

- **Purpose**: ${PLACEHOLDER} what the schema or data looks like after it, and why.
- **Checks**: ${PLACEHOLDER} the queries a promoter runs after \`db push\` to see it worked.
- **Promoter notes**: ${PLACEHOLDER} deploy order against the API, whether it writes data, anything done by hand.

## Rollback

${PLACEHOLDER} When reverting is worth it, and how: a forward migration (sql below), or
"not reversible, restore from backup" with the steps
([playbook](../../db-rollback-playbook.md#decision-matrix)).

\`\`\`sql
-- ${PLACEHOLDER} the statements a later forward migration runs to undo it
\`\`\`
`;
}

function cmdNew(name) {
  if (!name || !NAME.test(name)) {
    console.error("Usage: npm run migration:new -- <snake_case_name>   (letters, digits, underscores)");
    process.exit(2);
  }
  fetchBase("origin/main");
  let base = [];
  try {
    base = migrationsAt("origin/main");
  } catch {
    console.warn("No origin/main to read; versioning against the working tree only.");
  }
  const taken = [...base, ...migrationsOnDisk()].map((f) => f.slice(0, 14));
  const file = `${freshVersion(taken)}_${name}.sql`;
  const sqlPath = join(MIGRATIONS, file);
  const pagePath = join(MIGRATION_LEDGER_DIR, file.replace(/\.sql$/, ".md"));
  writeFileSync(join(REPO_ROOT, sqlPath), `-- ${name.replace(/_/g, " ")}\n`);
  writeFileSync(join(REPO_ROOT, pagePath), ledgerTemplate(file));
  console.log(`Created ${sqlPath}\nCreated ${pagePath}`);
  console.log(
    "If main gets a newer migration before this merges, run `npm run migration:renumber`.",
  );
}

function cmdRenumber() {
  const base = getArg("--base") ?? "origin/main";
  const dryRun = process.argv.includes("--dry-run");
  fetchBase(base);
  const mergeBase = git(["merge-base", base, "HEAD"]);
  const onBase = migrationsAt(base);
  const known = new Set([...onBase, ...migrationsAt(mergeBase)]);
  const introduced = migrationsOnDisk().filter((f) => !known.has(f));
  const renames = planRenames(introduced, onBase);

  if (renames.length === 0) {
    console.log(
      introduced.length === 0
        ? "This branch adds no migrations."
        : `Nothing to do: ${introduced.join(", ")} already sort after ${base}.`,
    );
    return;
  }

  // Files this branch touched: committed since the merge base, staged, unstaged, untracked.
  const touched = new Set(
    [
      git(["diff", "--name-only", mergeBase]),
      git(["ls-files", "--others", "--exclude-standard"]),
    ]
      .join("\n")
      .split("\n")
      .filter(Boolean),
  );

  for (const { from, to } of renames) {
    const moves = [[join(MIGRATIONS, from), join(MIGRATIONS, to)]];
    const page = join(MIGRATION_LEDGER_DIR, from.replace(/\.sql$/, ".md"));
    if (existsSync(join(REPO_ROOT, page))) {
      moves.push([page, join(MIGRATION_LEDGER_DIR, to.replace(/\.sql$/, ".md"))]);
    }
    for (const [a, b] of moves) {
      console.log(`${dryRun ? "would move" : "move"} ${a} -> ${b}`);
      if (dryRun) continue;
      try {
        git(["mv", a, b], { stdio: "ignore" });
      } catch {
        renameSync(join(REPO_ROOT, a), join(REPO_ROOT, b)); // untracked
      }
      touched.delete(a);
      touched.add(b);
    }
  }

  // References: each renamed stem, in every file the branch touched.
  const leftovers = [];
  for (const file of touched) {
    const path = join(REPO_ROOT, file);
    if (!existsSync(path)) continue;
    let text;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\u0000")) continue; // binary
    const { text: next, stale } = rewriteReferences(text, renames);
    for (const version of stale) leftovers.push(`${file}: ${version}`);
    if (next !== text) {
      console.log(`${dryRun ? "would update" : "update"} references in ${file}`);
      if (!dryRun) writeFileSync(path, next);
    }
  }

  if (leftovers.length > 0) {
    console.log(
      "\nThese files still name an old version on its own (an anchor, a heading). " +
        "Check each: it may be main's migration of the same version, which must stay.",
    );
    for (const line of leftovers) console.log(`  ${line}`);
  }
  console.log(
    `\nThen: node scripts/check-migration-safety.mjs --base ${base} --head HEAD, and commit.`,
  );
}

if (isInvokedDirectly(import.meta.url)) {
  const [command, arg] = process.argv.slice(2);
  if (command === "new") cmdNew(arg);
  else if (command === "renumber") cmdRenumber();
  else {
    console.error("Usage: node scripts/migration.mjs new <name> | renumber [--dry-run] [--base <ref>]");
    process.exit(2);
  }
}
