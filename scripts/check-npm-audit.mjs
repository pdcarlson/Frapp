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
 *     the same package. Ids are case-normalized on both sides.
 *   - An empty allowlist fails on EVERY high/critical advisory — the gate
 *     cannot be satisfied by emptying the list.
 *   - Every entry must carry a reason, a tracking issue, and an expiry date.
 *     An EXPIRED entry whose advisory is still present fails the gate: debt
 *     must be re-triaged (bump the date with a justification, or fix it),
 *     never silently carried forever.
 *   - Entries whose advisory no longer appears at a gated severity are
 *     reported as stale so they get pruned, but do not fail the gate.
 *   - Moderate/low advisories are reported for visibility and never fail.
 *   - Fail closed: unparseable audit output, a malformed allowlist, or a
 *     gated-severity advisory whose GHSA id cannot be determined are all
 *     hard failures, never silent skips.
 *
 * Flags:
 *   --soft-network  when `npm audit` itself cannot produce a usable report
 *                   (offline, registry unreachable), warn and exit 0 instead
 *                   of failing. Passed only by the local gate so an offline
 *                   dev isn't hard-blocked (same convention as the secret
 *                   scan's --soft-missing); the CI job omits it, staying the
 *                   hard gate. Allowlist validation and audit-content
 *                   failures are NEVER softened.
 *
 * Audit is run with --package-lock-only (lockfile + registry only, no
 * node_modules needed) and explicit --include=dev --include=optional so a
 * future .npmrc `omit`/`production` setting cannot silently shrink the
 * audited tree.
 *
 * Docs: docs/internal/security/SECURITY_FIXES.md § npm audit sweep + CI gate.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWLIST_PATH = join(ROOT, "scripts", "npm-audit-allowlist.json");

/** Severities that block the gate. Everything else is informational. */
export const GATE_SEVERITIES = new Set(["high", "critical"]);

const ALLOWED_SEVERITY_FIELD = new Set(["critical", "high", "moderate", "low"]);
const GHSA_PATTERN = /^GHSA(-[a-hjkmnp-z2-9]{4}){3}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Canonical GHSA form: uppercase "GHSA" prefix, lowercase id groups (pure —
 * unit-tested). Both the audit side and the allowlist side go through this,
 * so a case-variant entry still matches its advisory.
 */
export function normalizeGhsa(id) {
  return `GHSA${String(id).slice(4).toLowerCase()}`;
}

/**
 * Extract the unique advisories from `npm audit --json` v2 output (pure —
 * unit-tested). Package entries chain to their root causes via `via`: objects
 * are real advisories, strings are pointers to another package entry, so only
 * the objects carry a GHSA id and a severity of their own.
 *
 * Fail closed: an advisory object at a gated severity whose GHSA id cannot be
 * parsed from its url is a hard error — silently skipping it would let a
 * high/critical ship ungated (and unallowlistable).
 * @returns {Array<{ghsa:string, severity:string, package:string, title:string, url:string}>}
 */
export function collectAdvisories(auditJson) {
  if (!auditJson || typeof auditJson.vulnerabilities !== "object" || auditJson.vulnerabilities === null) {
    throw new Error("npm audit output has no `vulnerabilities` object");
  }
  const byGhsa = new Map();
  for (const pkg of Object.values(auditJson.vulnerabilities)) {
    for (const via of pkg.via ?? []) {
      if (typeof via !== "object" || via === null) continue;
      const match = GHSA_PATTERN.exec(String(via.url ?? "").split("/").pop() ?? "");
      if (!match) {
        if (GATE_SEVERITIES.has(via.severity)) {
          throw new Error(
            `audit reports a ${via.severity} advisory for ${via.name ?? "?"} with no parseable GHSA id ` +
              `(url: ${JSON.stringify(via.url ?? null)}) — refusing to pass what cannot be gated`,
          );
        }
        continue;
      }
      const ghsa = normalizeGhsa(match[0]);
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
 * empty one. `package`/`severity` are optional documentation fields but must
 * be sane when present (severity drift against the live advisory is warned
 * about at report time).
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
    } else {
      const normalized = normalizeGhsa(entry.ghsa);
      if (seen.has(normalized)) {
        errors.push(`${label}: duplicate entry for ${normalized}`);
      } else {
        seen.add(normalized);
      }
    }
    if (typeof entry.reason !== "string" || entry.reason.trim().length < 10) {
      errors.push(`${label}: \`reason\` must explain why this advisory is accepted (min 10 chars)`);
    }
    if (typeof entry.trackedBy !== "string" || !/^#\d+$/.test(entry.trackedBy)) {
      errors.push(`${label}: \`trackedBy\` must reference a GitHub issue like "#289"`);
    }
    // Expiry dates are UTC calendar days; the round-trip check rejects
    // rollover dates like 2026-02-30 that Date.parse would silently accept.
    const expiresDate =
      typeof entry.expires === "string" && DATE_PATTERN.test(entry.expires)
        ? new Date(`${entry.expires}T00:00:00Z`)
        : null;
    if (
      expiresDate === null ||
      Number.isNaN(expiresDate.getTime()) ||
      expiresDate.toISOString().slice(0, 10) !== entry.expires
    ) {
      errors.push(`${label}: \`expires\` must be a real YYYY-MM-DD date`);
    }
    if ("package" in entry && (typeof entry.package !== "string" || entry.package.trim() === "")) {
      errors.push(`${label}: \`package\` (optional) must be a non-empty string when present`);
    }
    if ("severity" in entry && !ALLOWED_SEVERITY_FIELD.has(entry.severity)) {
      errors.push(`${label}: \`severity\` (optional) must be one of critical|high|moderate|low when present`);
    }
  });
  return errors;
}

/**
 * Decide the gate outcome (pure — unit-tested).
 * @param {{advisories:Array, entries:Array, today:string}} args `today` as YYYY-MM-DD (UTC).
 */
export function evaluateAudit({ advisories, entries, today }) {
  const gated = advisories.filter((a) => GATE_SEVERITIES.has(a.severity));
  const byGhsa = new Map(entries.map((e) => [normalizeGhsa(e.ghsa), e]));
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
  const staleEntries = entries.filter((e) => !gatedIds.has(normalizeGhsa(e.ghsa)));
  return {
    failures,
    expiredInUse,
    allowlisted,
    staleEntries,
    ok: failures.length === 0 && expiredInUse.length === 0,
  };
}

/**
 * Interpret a finished `npm audit --json` invocation (pure — unit-tested).
 * npm audit exits 1 whenever vulnerabilities exist, so the exit code alone is
 * not a transport failure; parseable JSON without an `error` payload is the
 * success signal. Throws (fail closed) when the output cannot be interpreted.
 */
export function parseAuditOutput({ stdout, status, stderr }) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(
      `npm audit did not produce JSON (exit ${status}).\nstderr: ${String(stderr).slice(0, 2000)}`,
    );
  }
  if (parsed.error) {
    throw new Error(`npm audit failed: ${parsed.error.summary ?? JSON.stringify(parsed.error)}`);
  }
  return parsed;
}

/**
 * Parse the raw allowlist file contents (pure — unit-tested). Throws on
 * invalid JSON; shape problems are left to validateAllowlist so they produce
 * itemized errors rather than one opaque throw.
 */
export function parseAllowlistSource(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`allowlist is not valid JSON: ${error.message}`);
  }
  return parsed.entries;
}

function runNpmAudit() {
  const result = spawnSync(
    "npm",
    ["audit", "--json", "--package-lock-only", "--include=dev", "--include=optional"],
    {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      // npm is npm.cmd on Windows; spawning it there needs a shell. Args are
      // static strings, so shell interpretation introduces no injection risk.
      shell: process.platform === "win32",
    },
  );
  if (result.error) {
    throw new Error(`failed to spawn npm audit: ${result.error.message}`);
  }
  return parseAuditOutput(result);
}

function loadAllowlist() {
  let raw;
  try {
    raw = readFileSync(ALLOWLIST_PATH, "utf8");
  } catch (error) {
    throw new Error(`cannot read ${ALLOWLIST_PATH}: ${error.message}`);
  }
  try {
    return parseAllowlistSource(raw);
  } catch (error) {
    throw new Error(`${ALLOWLIST_PATH}: ${error.message}`);
  }
}

function describe(advisory) {
  return `${advisory.ghsa}  [${advisory.severity}]  ${advisory.package} — ${advisory.title}\n      ${advisory.url}`;
}

function main() {
  const softNetwork = process.argv.includes("--soft-network");

  // Policy problems are never softened: a malformed allowlist must fail even
  // offline, or a broken policy file could ride along unnoticed.
  const entries = loadAllowlist();
  const validationErrors = validateAllowlist(entries);
  if (validationErrors.length > 0) {
    console.error("❌ npm audit gate: allowlist is malformed:");
    for (const error of validationErrors) console.error(`  - ${error}`);
    process.exit(1);
  }

  let auditJson;
  try {
    auditJson = runNpmAudit();
  } catch (error) {
    if (softNetwork) {
      console.warn(`⚠️  npm audit gate: could not obtain an audit report (${error.message.split("\n")[0]}).`);
      console.warn("   Continuing because --soft-network is set (offline dev path); the CI dependency-audit job is the hard gate.");
      return;
    }
    throw error;
  }

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
      const drift =
        entry.severity && entry.severity !== advisory.severity
          ? `  ⚠️ entry says ${entry.severity}, live advisory is ${advisory.severity} — update the entry`
          : "";
      console.log(`  - ${advisory.ghsa} [${advisory.severity}] ${advisory.package} — tracked by ${entry.trackedBy}, expires ${entry.expires}${drift}`);
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

// realpathSync both sides: for an ESM entry module `import.meta.url` is
// symlink-resolved while `process.argv[1]` is not, and a mismatch here must
// not silently skip main() — that would make the gate exit 0 having checked
// nothing (observed with checkouts reached through symlinked paths).
function isInvokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isInvokedDirectly()) {
  try {
    main();
  } catch (error) {
    console.error(`❌ npm audit gate: ${error.message}`);
    process.exit(1);
  }
}
