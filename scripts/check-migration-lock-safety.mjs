#!/usr/bin/env node
// Migration lock-safety linting (Squawk). ADVISORY — reports, never blocks.
//
// Runs Squawk over the migrations a change actually touches and looks for the
// patterns that take a heavy lock on a live table: a foreign key or check
// constraint added without NOT VALID, a column added with a volatile default, a
// unique constraint that builds its index under an exclusive lock, a dropped
// NOT NULL. These are the changes that are instant on an empty staging table
// and a multi-second write outage on a production one.
//
// ── Why advisory, and what it would take to make it blocking ────────────────
// Measured 2026-08-24 against all 51 migrations in the repo: Squawk's default
// rule set reports 403 issues in 44 of them. Nothing in that number is a
// surprise or a bug — it is what happens when a linter meets a corpus written
// before it. `.squawk.toml` excludes the five rules responsible for 390 of
// those 403, each for a reason recorded in that file (two of them flag a fix
// that is IMPOSSIBLE under Supabase, which applies each migration inside a
// transaction). What remains is 13 findings across 8 files — real lock-safety
// observations on already-deployed tables.
//
// So even tuned, this cannot be a hard block today: any PR touching one of
// those 8 files would fail on a finding it did not introduce. Making it
// blocking needs a baseline of the existing 13 — the same move
// `scripts/dependency-cruiser-known-violations.json` makes for the architecture gate,
// which is what lets THAT gate be strict from day one. That is a deliberate,
// separate change; `--strict` below exists so it is a one-line switch when
// someone decides to make it.
//
// Until then the posture is honest: this job reports, and a human reads it.
//
// Usage:
//   node scripts/check-migration-lock-safety.mjs --base <sha> --head <sha>
//   node scripts/check-migration-lock-safety.mjs --all
//   node scripts/check-migration-lock-safety.mjs --all --strict   (exit 1 on findings)

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const MIGRATIONS_PREFIX = "supabase/migrations/";
const SQUAWK_BIN = join(process.cwd(), "node_modules", ".bin", "squawk");
const CONFIG = join(process.cwd(), ".squawk.toml");

// Squawk's own severities. Only these two exist in its JSON output today; an
// unknown one is treated as a warning rather than dropped, so a new severity
// cannot silently vanish from the report.
const SEVERITY_ORDER = ["error", "warning"];

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("-")) {
    console.error(`Error: flag ${name} requires a value.`);
    process.exit(2);
  }
  return value;
}

const hasFlag = (name) => process.argv.includes(name);

// ── File selection ──────────────────────────────────────────────────────────

export function migrationFilesFromDiff(changedFiles) {
  return changedFiles
    .filter((file) => file.startsWith(MIGRATIONS_PREFIX) && file.endsWith(".sql"))
    // A migration deleted in this change has nothing to lint, and Squawk would
    // fail on the missing path.
    .filter((file) => existsSync(join(process.cwd(), file)));
}

function changedFiles(base, head) {
  for (const range of [`${base}...${head}`, `${base}..${head}`]) {
    try {
      const out = execFileSync("git", ["diff", "--name-only", range], {
        encoding: "utf8",
      }).trim();
      return out ? out.split("\n").map((l) => l.trim()).filter(Boolean) : [];
    } catch {
      // Try the next range expression.
    }
  }
  throw new Error(
    `Unable to diff base=${base} head=${head}. Ensure checkout fetch-depth is 0.`,
  );
}

function allMigrations() {
  try {
    return readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => `${MIGRATIONS_PREFIX}${f}`);
  } catch {
    return [];
  }
}

// ── Squawk ──────────────────────────────────────────────────────────────────

export function runSquawk(files, { bin = SQUAWK_BIN, config = CONFIG } = {}) {
  if (files.length === 0) return [];

  const args = [];
  if (existsSync(config)) args.push("--config", config);
  args.push("--reporter", "json", ...files);

  let stdout;
  try {
    stdout = execFileSync(bin, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  } catch (error) {
    // Squawk exits non-zero when it finds issues; the JSON is still on stdout.
    // A genuine crash produces no parseable stdout and is re-thrown below.
    stdout = error.stdout ?? "";
    if (!stdout.trim()) {
      throw new Error(`squawk failed to run: ${error.stderr || error.message}`);
    }
  }

  try {
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new Error("squawk produced output that was not valid JSON.");
  }
}

// ── Reporting ───────────────────────────────────────────────────────────────

export function groupByFile(findings) {
  const byFile = new Map();
  for (const finding of findings) {
    const file = finding.file ?? "(unknown)";
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(finding);
  }
  return byFile;
}

export function countByRule(findings) {
  const counts = new Map();
  for (const finding of findings) {
    const rule = finding.rule_name ?? "(unknown)";
    counts.set(rule, (counts.get(rule) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function severityRank(severity) {
  const index = SEVERITY_ORDER.indexOf(String(severity).toLowerCase());
  return index === -1 ? SEVERITY_ORDER.length : index;
}

export function buildSummary({ findings, filesChecked, strict }) {
  if (filesChecked.length === 0) {
    return "## Migration lock safety\n\nNo migrations changed — nothing to lint.";
  }

  const lines = ["## Migration lock safety", ""];

  if (findings.length === 0) {
    lines.push(
      `No lock-safety findings in ${filesChecked.length} changed migration(s):`,
      "",
      ...filesChecked.map((f) => `- \`${f}\``),
    );
    return lines.join("\n");
  }

  lines.push(
    strict
      ? `**${findings.length} finding(s)** in ${filesChecked.length} changed migration(s). This check is BLOCKING.`
      : `**${findings.length} finding(s)** in ${filesChecked.length} changed migration(s). This check is **advisory** — it does not block the merge. Read them and decide.`,
    "",
    "| Rule | Count |",
    "| ---- | ----: |",
    ...countByRule(findings).map(([rule, n]) => `| \`${rule}\` | ${n} |`),
    "",
  );

  for (const [file, fileFindings] of groupByFile(findings)) {
    lines.push(`### \`${file}\``, "");
    const sorted = [...fileFindings].sort(
      (a, b) =>
        severityRank(a.severity) - severityRank(b.severity) ||
        (a.line ?? 0) - (b.line ?? 0),
    );
    for (const finding of sorted) {
      const where = finding.line ? `:${finding.line}` : "";
      lines.push(
        `- **${finding.rule_name}**${where} — ${finding.message ?? "(no message)"}`,
      );
      if (finding.help) lines.push(`  - ${finding.help}`);
    }
    lines.push("");
  }

  lines.push(
    "Rule reference: <https://squawkhq.com/docs/rules>. Rules this repo excludes,",
    "and why, are documented in `.squawk.toml`.",
  );

  return lines.join("\n");
}

function writeSummary(summary) {
  const target = process.env.GITHUB_STEP_SUMMARY;
  if (!target) return;
  try {
    appendFileSync(target, `${summary}\n`);
  } catch {
    // A summary that cannot be written must not change the outcome.
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const strict = hasFlag("--strict");
  const base = getArg("--base");
  const head = getArg("--head");

  let files;
  if (hasFlag("--all")) {
    files = allMigrations();
  } else if (base && head) {
    files = migrationFilesFromDiff(changedFiles(base, head));
  } else {
    console.error(
      "Error: pass --all, or both --base and --head.\n" +
        "  node scripts/check-migration-lock-safety.mjs --base <sha> --head <sha>",
    );
    process.exit(2);
  }

  if (files.length === 0) {
    console.log("No migrations to lint.");
    writeSummary(buildSummary({ findings: [], filesChecked: [], strict }));
    return 0;
  }

  console.log(`Linting ${files.length} migration(s) for lock safety:`);
  for (const file of files) console.log(`  - ${file}`);

  if (!existsSync(SQUAWK_BIN)) {
    // Advisory checks must not fail the build on their own tooling. Say so
    // loudly and pass — a missing linter is a CI problem, not a migration
    // problem, and the drift gate is what actually protects the database.
    console.warn(
      `::warning::squawk not found at ${SQUAWK_BIN}. Skipping lock-safety linting (run \`npm ci\`).`,
    );
    return 0;
  }

  const findings = runSquawk(files);
  const summary = buildSummary({ findings, filesChecked: files, strict });
  writeSummary(summary);

  if (findings.length === 0) {
    console.log("\nNo lock-safety findings.");
    return 0;
  }

  console.log(`\n${findings.length} lock-safety finding(s):\n`);
  for (const [file, fileFindings] of groupByFile(findings)) {
    console.log(`  ${file}`);
    for (const finding of fileFindings) {
      console.log(
        `    ${finding.rule_name}${finding.line ? `:${finding.line}` : ""} — ${finding.message ?? ""}`,
      );
    }
  }

  for (const [rule, count] of countByRule(findings)) {
    console.log(`::warning::${rule}: ${count} finding(s) in changed migrations.`);
  }

  if (strict) {
    console.error(
      "::error::Lock-safety findings present and --strict was passed. See the job summary.",
    );
    return 1;
  }

  console.log(
    "\nAdvisory only — this does not block the merge. See .squawk.toml for the",
  );
  console.log("rules this repo excludes and why.");
  return 0;
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  try {
    process.exit(main());
  } catch (error) {
    // Even a crash is advisory: report it, do not fail the build on it.
    console.warn(`::warning::Lock-safety linting could not run: ${error.message}`);
    process.exit(hasFlag("--strict") ? 1 : 0);
  }
}
