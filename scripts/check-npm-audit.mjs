#!/usr/bin/env node

/**
 * npm audit gate shared by the CI `dependency-audit` job and
 * `npm run ci:local-gate`. Fails when `npm audit` reports any HIGH or
 * CRITICAL advisory that is not explicitly allowlisted in
 * scripts/npm-audit-allowlist.json.
 *
 * Gate semantics (issue #618):
 *   - Advisories are keyed by GHSA id, not by package name, so one allowlist
 *     entry can never swallow a different advisory that happens to land in
 *     the same package.
 *   - An empty allowlist fails on EVERY high/critical advisory — the gate
 *     cannot be satisfied by emptying the list.
 *   - Every entry must carry a reason, a tracking issue, and an expiry date.
 *     An EXPIRED entry whose advisory is still present fails the gate: debt
 *     must be re-triaged (bump the date with a justification, or fix it),
 *     never silently carried forever.
 *   - Entries whose advisory no longer appears at a gated severity are
 *     reported as stale so they get pruned, but do not fail the gate.
 *   - Moderate/low advisories are reported for visibility and never fail.
 *
 * Audit is run with --package-lock-only: the gate needs only the lockfile
 * and registry access, not an installed node_modules tree.
 *
 * Docs: docs/internal/security/SECURITY_FIXES.md ("npm audit CI gate").
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWLIST_PATH = join(ROOT, "scripts", "npm-audit-allowlist.json");

/** Severities that block the gate. Everything else is informational. */
export const GATE_SEVERITIES = new Set(["high", "critical"]);

const GHSA_PATTERN = /^GHSA(-[a-hjkmnp-z2-9]{4}){3}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Extract the unique advisories from `npm audit --json` v2 output (pure —
 * unit-tested). Package entries chain to their root causes via `via`: objects
 * are real advisories, strings are pointers to another package entry, so only
 * the objects carry a GHSA id and a severity of their own.
 * @returns {Array<{ghsa:string, severity:string, package:string, title:string, url:string}>}
 */
export function collectAdvisories(auditJson) {
  if (!auditJson || typeof auditJson.vulnerabilities !== "object") {
    throw new Error("npm audit output has no `vulnerabilities` object");
  }
  const byGhsa = new Map();
  for (const pkg of Object.values(auditJson.vulnerabilities)) {
    for (const via of pkg.via ?? []) {
      if (typeof via !== "object" || via === null || !via.url) continue;
      const ghsa = String(via.url).split("/").pop();
      if (!byGhsa.has(ghsa)) {
        byGhsa.set(ghsa, {
          ghsa,
          severity: via.severity,
          package: via.name,
          title: via.title,
          url: via.url,
        });
      }
    }
  }
  return [...byGhsa.values()];
}

/**
 * Validate allowlist shape (pure — unit-tested). Returns human-readable
 * errors; any error fails the gate so a malformed list can never pass as an
 * empty one.
 */
export function validateAllowlist(entries) {
  const errors = [];
  if (!Array.isArray(entries)) {
    return ["allowlist `entries` must be an array"];
  }
  const seen = new Set();
  entries.forEach((entry, i) => {
    const label = `entries[${i}]`;
    if (typeof entry !== "object" || entry === null) {
      errors.push(`${label}: must be an object`);
      return;
    }
    if (!GHSA_PATTERN.test(entry.ghsa ?? "")) {
      errors.push(`${label}: \`ghsa\` must be a GHSA-xxxx-xxxx-xxxx id (got ${JSON.stringify(entry.ghsa)})`);
    } else if (seen.has(entry.ghsa)) {
      errors.push(`${label}: duplicate entry for ${entry.ghsa}`);
    } else {
      seen.add(entry.ghsa);
    }
    if (typeof entry.reason !== "string" || entry.reason.trim().length < 10) {
      errors.push(`${label}: \`reason\` must explain why this advisory is accepted (min 10 chars)`);
    }
    if (typeof entry.trackedBy !== "string" || !/^#\d+$/.test(entry.trackedBy)) {
      errors.push(`${label}: \`trackedBy\` must reference a GitHub issue like "#289"`);
    }
    if (typeof entry.expires !== "string" || !DATE_PATTERN.test(entry.expires) || Number.isNaN(Date.parse(entry.expires))) {
      errors.push(`${label}: \`expires\` must be a valid YYYY-MM-DD date`);
    }
  });
  return errors;
}

/**
 * Decide the gate outcome (pure — unit-tested).
 * @param {{advisories:Array, entries:Array, today:string}} args `today` as YYYY-MM-DD.
 */
export function evaluateAudit({ advisories, entries, today }) {
  const gated = advisories.filter((a) => GATE_SEVERITIES.has(a.severity));
  const byGhsa = new Map(entries.map((e) => [e.ghsa, e]));
  const failures = [];
  const expiredInUse = [];
  const allowlisted = [];
  for (const advisory of gated) {
    const entry = byGhsa.get(advisory.ghsa);
    if (!entry) {
      failures.push(advisory);
    } else if (entry.expires < today) {
      expiredInUse.push({ advisory, entry });
    } else {
      allowlisted.push({ advisory, entry });
    }
  }
  const gatedIds = new Set(gated.map((a) => a.ghsa));
  const staleEntries = entries.filter((e) => !gatedIds.has(e.ghsa));
  return {
    failures,
    expiredInUse,
    allowlisted,
    staleEntries,
    ok: failures.length === 0 && expiredInUse.length === 0,
  };
}

function runNpmAudit() {
  const result = spawnSync("npm", ["audit", "--json", "--package-lock-only"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  // npm audit exits 1 whenever vulnerabilities exist, so the exit code alone
  // is not a transport failure. Parseable JSON is the success signal; fail
  // closed (this is a security gate) when the output cannot be interpreted.
  if (result.error) {
    throw new Error(`failed to spawn npm audit: ${result.error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `npm audit did not produce JSON (exit ${result.status}).\nstderr: ${String(result.stderr).slice(0, 2000)}`,
    );
  }
  if (parsed.error) {
    throw new Error(`npm audit failed: ${parsed.error.summary ?? JSON.stringify(parsed.error)}`);
  }
  return parsed;
}

function loadAllowlist() {
  let raw;
  try {
    raw = readFileSync(ALLOWLIST_PATH, "utf8");
  } catch (error) {
    throw new Error(`cannot read ${ALLOWLIST_PATH}: ${error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${ALLOWLIST_PATH} is not valid JSON: ${error.message}`);
  }
  return parsed.entries;
}

function describe(advisory) {
  return `${advisory.ghsa}  [${advisory.severity}]  ${advisory.package} — ${advisory.title}\n      ${advisory.url}`;
}

function main() {
  const entries = loadAllowlist();
  const validationErrors = validateAllowlist(entries);
  if (validationErrors.length > 0) {
    console.error("❌ npm audit gate: allowlist is malformed:");
    for (const error of validationErrors) console.error(`  - ${error}`);
    process.exit(1);
  }

  const auditJson = runNpmAudit();
  const advisories = collectAdvisories(auditJson);
  const today = new Date().toISOString().slice(0, 10);
  const outcome = evaluateAudit({ advisories, entries, today });

  const totals = auditJson.metadata?.vulnerabilities ?? {};
  console.log(
    `npm audit: ${totals.total ?? "?"} package findings ` +
      `(critical ${totals.critical ?? "?"}, high ${totals.high ?? "?"}, ` +
      `moderate ${totals.moderate ?? "?"}, low ${totals.low ?? "?"}) — ` +
      `${advisories.length} unique advisories.`,
  );

  if (outcome.allowlisted.length > 0) {
    console.log(`\nAllowlisted high/critical advisories (${outcome.allowlisted.length}):`);
    for (const { advisory, entry } of outcome.allowlisted) {
      console.log(`  - ${advisory.ghsa} [${advisory.severity}] ${advisory.package} — tracked by ${entry.trackedBy}, expires ${entry.expires}`);
    }
  }
  if (outcome.staleEntries.length > 0) {
    console.log(`\n⚠️  Stale allowlist entries — no longer matching a high/critical advisory; prune them:`);
    for (const entry of outcome.staleEntries) {
      console.log(`  - ${entry.ghsa} (tracked by ${entry.trackedBy})`);
    }
  }

  if (outcome.expiredInUse.length > 0) {
    console.error(`\n❌ EXPIRED allowlist entries still shielding live advisories (${outcome.expiredInUse.length}):`);
    for (const { advisory, entry } of outcome.expiredInUse) {
      console.error(`  - ${describe(advisory)}\n      expired ${entry.expires}, tracked by ${entry.trackedBy} — re-triage: fix it or renew the entry with justification.`);
    }
  }
  if (outcome.failures.length > 0) {
    console.error(`\n❌ Unallowlisted HIGH/CRITICAL advisories (${outcome.failures.length}):`);
    for (const advisory of outcome.failures) {
      console.error(`  - ${describe(advisory)}`);
    }
    console.error(
      "\nFix: `npm audit fix` (or a targeted bump per docs/internal/security/SECURITY_FIXES.md).\n" +
        "Only if the fix genuinely cannot land now: add an allowlist entry to\n" +
        "scripts/npm-audit-allowlist.json with a reason, a tracking issue, and an expiry.",
    );
  }

  if (!outcome.ok) {
    process.exit(1);
  }
  console.log("\n✅ npm audit gate passed: no unallowlisted high/critical advisories.");
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    console.error(`❌ npm audit gate: ${error.message}`);
    process.exit(1);
  }
}
