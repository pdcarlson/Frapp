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
 * Exit codes (repo convention):
 *   1  npm produced a report and something in it must be acted on — an
 *      unallowlisted high/critical advisory, an expired entry still shielding
 *      one, a malformed allowlist, or a gated advisory whose id cannot be
 *      parsed. That last one is exit 1 precisely BECAUSE npm reported a real
 *      advisory; only its id is unreadable, and a human must look at it.
 *   2  no report was obtained — npm did not answer, or answered in a shape
 *      this cannot read. Nothing has been established about the tree.
 *   Both fail closed. They are split because "your dependencies are unsafe"
 *   and "ask me again, I never found out" call for different responses, and
 *   collapsing them is what made the two blocked merges in issue #1638
 *   unreadable.
 *
 * Transport retry (issue #1638):
 *   `npm audit` is almost entirely network wait — measured at ~115s wall for
 *   ~2.5s of CPU. On a degraded registry it reports the failure IN ITS STDOUT
 *   PAYLOAD and exits 1 — the SAME code it uses when it found vulnerabilities
 *   and the audit worked perfectly. So the exit code cannot separate the two
 *   cases and the payload is the only truth. Do not add a `status` fast-path:
 *   every dead-registry payload would classify as a finding.
 *
 *   npm already retries internally: `fetch-retries` defaults to 2 over a
 *   `fetch-timeout` of 300s each. THAT is the 5m42s and 7m0s the two #1638
 *   failures spent before giving up — npm's own schedule, invisible from here
 *   and unbounded from a job's point of view. Stacking a second retry layer on
 *   top of it would triple that; capping attempts BELOW it would kill audits
 *   npm was about to finish, converting slow-but-healthy runs into failures.
 *
 *   So the layers are collapsed rather than stacked. `--fetch-retries=0` moves
 *   the retry decision up here where it is logged, bounded, and testable, and
 *   `--fetch-timeout` is pinned so an .npmrc cannot move the ceiling under it.
 *   One attempt is then a single request npm cannot silently multiply, and the
 *   spawn cap sits just ABOVE that ceiling — it fires only for a process that
 *   is genuinely stuck, never for one still inside npm's own budget.
 *
 *   Only the transport is ever re-asked. A report npm actually produced is
 *   never retried: re-rolling a verdict until it is convenient is how a gate
 *   stops being one.
 *
 * Flags:
 *   --soft-network  when `npm audit` itself cannot produce a usable report —
 *                   offline, registry unreachable, but also any broken local
 *                   npm state (missing lockfile, bad config) — warn and exit
 *                   0 instead of failing. Passed only by the local gate so an
 *                   offline dev isn't hard-blocked (same convention as the
 *                   secret scan's --soft-missing); the CI job omits it and
 *                   hard-fails every one of those states. Allowlist
 *                   validation and audit-content failures are NEVER softened.
 *                   It also drops to a single attempt: the only conclusion a
 *                   retry schedule can reach offline is the warning itself,
 *                   and a dev should hear it in seconds.
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

/**
 * No verdict was reached — exit 2, never exit 1.
 *
 * `retriable` distinguishes the two ways that happens. A transport failure
 * (npm never answered) is worth re-asking. A shape failure (npm answered,
 * but with something this cannot gate) will say the same thing three times.
 */
export class AuditUnavailableError extends Error {
  constructor(message, { retriable = false } = {}) {
    super(message);
    this.name = "AuditUnavailableError";
    this.retriable = retriable;
  }
}

/**
 * Human-readable cause for npm's transport-error payload (pure — unit-tested).
 *
 * npm reports an unreachable registry as, verbatim:
 *   {"message":"request to … failed, reason: connect ECONNREFUSED …",
 *    "error":{"summary":"","detail":""}}
 *
 * Two traps live in that shape, and #1638 hit both. `summary` is an EMPTY
 * STRING rather than absent, so the original `summary ?? fallback` never fell
 * through — `??` only tests nullish — and the gate printed `npm audit failed: `
 * with nothing after it, twice, on two blocked merges. And the fallback it
 * would have reached, `JSON.stringify(error)`, is `{"summary":"","detail":""}`:
 * no better. The reason is only ever in the TOP-LEVEL `message`, so that is
 * what this reaches for once the documented fields come back empty.
 */
export function describeNpmFailure(parsed) {
  for (const candidate of [parsed?.error?.summary, parsed?.message, parsed?.error?.detail]) {
    if (typeof candidate === "string" && candidate.trim() !== "") return redactUrlCredentials(candidate.trim());
  }
  return redactUrlCredentials(JSON.stringify(parsed?.error ?? parsed ?? null));
}

/**
 * Strip `user:password@` out of any URL in a message before it is printed.
 *
 * npm echoes the registry URL verbatim into its failure message, credentials
 * and all — verified: a registry of `http://ciuser:s3cr3t-token@host/` comes
 * back as `request to http://ciuser:s3cr3t-token@host/… failed`. The old code
 * printed only `error.summary`, which carries no URL, so reading `message`
 * opened a NEW egress path. Public npmjs in CI has no token, but a developer
 * running `ci:local-gate` against an Artifactory/Nexus registry with basic
 * auth in the URL does — and that line is exactly what gets pasted into an
 * issue when the gate goes red.
 */
export function redactUrlCredentials(text) {
  return String(text).replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, "$1<redacted>@");
}

/**
 * npm error codes that describe the REPO or the ENVIRONMENT, not the network.
 * A missing lockfile or a 401 against a private registry is deterministic:
 * retrying spends the whole schedule to reprint it, and "re-run it" is the
 * wrong instruction. npm's transport payload carries no `code` at all, so an
 * absent code is what marks a genuine blip.
 */
const PERMANENT_NPM_ERROR_CODES = new Set(["ENOLOCK", "EUSAGE", "E401", "E403", "EPERM", "ERESOLVE"]);

/**
 * spawn failures that repeat identically. ENOBUFS/ENOMEM matter because the
 * same report overflows the same buffer on the next attempt.
 */
const PERMANENT_SPAWN_CODES = new Set(["ENOENT", "ENOBUFS", "ENOMEM", "EACCES"]);

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
    // npm answered in a shape this cannot read. Re-asking yields the same shape.
    throw new AuditUnavailableError("npm audit output has no `vulnerabilities` object", { retriable: false });
  }
  const byGhsa = new Map();
  for (const pkg of Object.values(auditJson.vulnerabilities)) {
    for (const via of pkg.via ?? []) {
      if (typeof via !== "object" || via === null) continue;
      const match = GHSA_PATTERN.exec(String(via.url ?? "").split("/").pop() ?? "");
      if (!match) {
        if (GATE_SEVERITIES.has(via.severity)) {
          // Exit 1, NOT 2 — deliberately a plain Error. npm reported a real
          // gated-severity advisory; only its id is unreadable. Routing this
          // to the no-verdict code would print "this is NOT a report of a
          // vulnerability … re-run it" over a live critical, and a maintainer
          // who re-runs, sees byte-identical output and calls it flake can
          // admin-merge past the gate. A human has to look at it.
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
 *
 * The exit code is useless here: npm exits 1 both when vulnerabilities exist
 * (the audit worked) and when the registry was unreachable (it did not), so
 * `status` cannot tell those apart and is deliberately not consulted. Only the
 * payload says what happened — parseable JSON without an `error` key is the
 * success signal. Anything else is a no-verdict, thrown
 * (fail closed) as AuditUnavailableError so the caller can tell it apart from
 * a real advisory finding and decide whether to re-ask.
 */
export function parseAuditOutput({ stdout, status, stderr }) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    // npm printed something that is not a report — typically a plaintext
    // `npm ERR! network …`. It never answered, so the transport is suspect.
    throw new AuditUnavailableError(
      `npm audit did not produce JSON (exit ${status}).\nstderr: ${redactUrlCredentials(String(stderr).slice(0, 2000))}`,
      { retriable: true },
    );
  }
  // `JSON.parse` returns null for the literal "null", and spawnSync can hand
  // back a null stdout. Dereferencing that threw a raw TypeError, which the
  // entry guard scored exit 1 — reporting a crash as an advisory finding.
  if (parsed === null || typeof parsed !== "object") {
    throw new AuditUnavailableError(
      `npm audit produced ${JSON.stringify(parsed)} instead of a report (exit ${status})`,
      { retriable: true },
    );
  }
  if (parsed.error) {
    throw new AuditUnavailableError(`npm audit reached no verdict: ${describeNpmFailure(parsed)}`, {
      retriable: !PERMANENT_NPM_ERROR_CODES.has(parsed.error.code),
    });
  }
  // A body with neither a report nor an `error` envelope, but carrying npm's
  // top-level `message`, is still npm telling us it failed — `describeNpmFailure`
  // reads that field, so `parseAuditOutput` must not treat it as a report.
  if (!parsed.vulnerabilities && typeof parsed.message === "string" && parsed.message.trim() !== "") {
    throw new AuditUnavailableError(`npm audit reached no verdict: ${describeNpmFailure(parsed)}`, {
      retriable: true,
    });
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

/** npm's per-request ceiling, pinned so an .npmrc cannot move it under the spawn cap. */
export const NPM_FETCH_TIMEOUT_MS = 300_000;

export function buildAuditArgs(fetchTimeoutMs = NPM_FETCH_TIMEOUT_MS) {
  return [
    "audit",
    "--json",
    "--package-lock-only",
    "--include=dev",
    "--include=optional",
    // Retry is this script's job, not npm's — see the header. Without this npm
    // turns one attempt into three silent ones and the schedule below is a lie.
    "--fetch-retries=0",
    `--fetch-timeout=${fetchTimeoutMs}`,
  ];
}

export const AUDIT_ARGS = buildAuditArgs();

/**
 * The offline path's per-request budget.
 *
 * A refused connection or a failed DNS lookup errors in milliseconds, but a
 * captive portal or a VPN that black-holes packets does not: npm just sits on
 * its full budget. With the CI budget that makes `--soft-network` take five
 * minutes to print a warning whose only purpose is to unblock the dev
 * immediately. This is what makes "a dev should hear it in seconds" true.
 */
export const SOFT_FETCH_TIMEOUT_MS = 20_000;

/**
 * Hard ceiling on ONE attempt — deliberately just ABOVE npm's own.
 *
 * The direction matters more than the number. Set below NPM_FETCH_TIMEOUT_MS
 * this would kill audits npm was still honestly working on, turning a slow
 * registry into a red required check; set at several multiples it stops
 * bounding anything. Just above means it fires only for a process that has
 * outlived npm's entire budget and is therefore stuck, not slow.
 */
export const TIMEOUT_MARGIN_MS = 30_000;
export const AUDIT_TIMEOUT_MS = NPM_FETCH_TIMEOUT_MS + TIMEOUT_MARGIN_MS;
/**
 * Three attempts over 70s of backoff — npm's own displaced schedule, restored.
 *
 * This is a REPLACEMENT, not an addition, and the numbers are npm's, not
 * invented: `--fetch-retries=0` above switches off 2 internal retries whose
 * `fetch-retry-mintimeout` is 10s and `fetch-retry-maxtimeout` 60s. That
 * schedule was buying real blip absorption across the ~10-70s window a
 * routine registry incident occupies. Moving the retry up here without
 * carrying its cadence would have shortened that window to a few seconds and
 * made the gate MORE likely to redden on an untouched PR — the exact #1638
 * symptom this exists to remove.
 *
 * Ceiling stays where it was: three attempts × npm's 300s per-request budget
 * plus 70s of backoff is the same worst case as before this change, now spent
 * on a schedule that is logged, bounded and testable rather than silent.
 */
export const AUDIT_ATTEMPTS = 3;
export const AUDIT_BACKOFF_MS = [10_000, 60_000];

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Bounded retry around one audit attempt (deps injected — unit-tested offline).
 *
 * Retries ONLY a transport AuditUnavailableError. A shape failure repeats
 * itself, and anything else is a verdict or a bug: re-running a gate that
 * already answered, until it answers differently, is not a retry.
 */
export async function runAuditWithRetry({
  runOnce,
  attempts = AUDIT_ATTEMPTS,
  backoffMs = AUDIT_BACKOFF_MS,
  sleep = defaultSleep,
  onRetry = () => {},
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await runOnce();
    } catch (error) {
      if (!(error instanceof AuditUnavailableError) || !error.retriable) throw error;
      lastError = error;
      if (attempt === attempts) break;
      onRetry({ attempt, attempts, error });
      await sleep(backoffMs[attempt - 1] ?? backoffMs.at(-1) ?? 1000);
    }
  }
  // `attempts < 1` would leave lastError unset and reject with undefined; the
  // entry guard then dereferences `.message` inside its own catch, producing
  // an unhandled rejection with no message at all.
  throw lastError ?? new AuditUnavailableError("no audit attempt was made", { retriable: false });
}

function runNpmAuditOnce(args = AUDIT_ARGS, timeoutMs = AUDIT_TIMEOUT_MS) {
  const options = {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    timeout: timeoutMs,
  };
  // npm is npm.cmd on Windows, which needs a shell — and shell+args-array is
  // deprecated (DEP0190), so the win32 branch passes one command string. The
  // args are static strings, so shell interpretation introduces no injection
  // risk.
  // KNOWN LIMITATION (#1644): on win32 the shell branch means `timeout` kills
  // cmd.exe, not the npm grandchild — Node does not job-object the tree. The
  // cap therefore bounds the wait, not the process, and a wedged audit can
  // outlive it. Linux/macOS CI, where this gate is required, is unaffected.
  const result =
    process.platform === "win32"
      ? spawnSync(["npm", ...args].join(" "), { ...options, shell: true })
      : spawnSync("npm", args, options);
  throwIfSpawnFailed(result, timeoutMs);
  return parseAuditOutput(result);
}

/**
 * Map a raw spawnSync outcome onto the retry taxonomy (pure — unit-tested).
 *
 * spawnSync surfaces a timeout as a kill SIGNAL, and on some Node versions as
 * an ETIMEDOUT `error` too — but it ALSO reports a maxBuffer overflow as
 * SIGTERM plus ENOBUFS. So the error code is examined first and the signal is
 * only trusted once no other code explains it; branching on the signal alone
 * blames a timeout that never happened. Either way this must throw rather than
 * fall through to parseAuditOutput, which would report a killed process as
 * `did not produce JSON (exit null)` — the same uninformative-message failure
 * #1638 was filed about.
 */
export function throwIfSpawnFailed(result, timeoutMs = AUDIT_TIMEOUT_MS) {
  const code = result.error?.code;
  // A signal alone does NOT mean the timeout fired: spawnSync reports a
  // maxBuffer overflow as SIGTERM + ENOBUFS too. Checking the signal first
  // would blame a 330s timeout that never happened, throw away the real code
  // and the stderr tail, and burn a second attempt on an identical overflow.
  if (code && code !== "ETIMEDOUT") {
    throw new AuditUnavailableError(`npm audit could not be run: ${redactUrlCredentials(result.error.message)} (${code})`, {
      retriable: !PERMANENT_SPAWN_CODES.has(code),
    });
  }
  if (result.signal || code === "ETIMEDOUT") {
    throw new AuditUnavailableError(
      `npm audit did not finish within ${timeoutMs / 1000}s (killed with ${result.signal ?? code})`,
      { retriable: true },
    );
  }
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

async function main() {
  const softNetwork = process.argv.includes("--soft-network");

  // Policy problems are never softened: a malformed allowlist must fail even
  // offline, or a broken policy file could ride along unnoticed.
  const entries = loadAllowlist();
  const validationErrors = validateAllowlist(entries);
  if (validationErrors.length > 0) {
    console.error("❌ npm audit gate: allowlist is malformed:");
    for (const error of validationErrors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }

  let auditJson;
  try {
    const fetchTimeoutMs = softNetwork ? SOFT_FETCH_TIMEOUT_MS : NPM_FETCH_TIMEOUT_MS;
    const args = buildAuditArgs(fetchTimeoutMs);
    auditJson = await runAuditWithRetry({
      runOnce: () => runNpmAuditOnce(args, fetchTimeoutMs + TIMEOUT_MARGIN_MS),
      attempts: softNetwork ? 1 : AUDIT_ATTEMPTS,
      onRetry: ({ attempt, attempts, error }) =>
        console.warn(`⚠️  npm audit attempt ${attempt}/${attempts} — ${error.message.split("\n")[0]}; retrying.`),
    });
  } catch (error) {
    if (softNetwork && error instanceof AuditUnavailableError) {
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
    process.exitCode = 1;
    return;
  }
  console.log("\n✅ npm audit gate passed: no unallowlisted high/critical advisories.");
}

// realpathSync BOTH sides: Node symlink-resolves the ESM entry's
// `import.meta.url` by default but never `process.argv[1]`, and with
// --preserve-symlinks-main it resolves neither — either asymmetry would make
// the comparison fail and silently skip main(), the gate exiting 0 having
// checked nothing (observed with checkouts reached through symlinked paths).
function isInvokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

/**
 * The exit-code split, as a function so it can be tested (pure — unit-tested).
 * Inlined in the entry guard it was unreachable from a test, and flipping it
 * would silently falsify the triage rule in SECURITY_FIXES.md § Prevention.
 */
export function exitCodeFor(error) {
  return error instanceof AuditUnavailableError ? 2 : 1;
}

/**
 * The second line of the exit-2 banner (pure — unit-tested).
 *
 * "Re-run it" is only true for the transport half. Telling an operator to
 * re-run a deterministic failure — a missing lockfile, a 401 — sends them to
 * repeat a fixed fact until they conclude the gate is flaky.
 */
export function noVerdictHint(error) {
  return error?.retriable
    ? "   Nothing about the dependency tree has been established; re-run it."
    : "   Re-running will reprint this: fix what the message names first.";
}

if (isInvokedDirectly()) {
  main().catch((error) => {
    const code = exitCodeFor(error);
    console.error(`❌ npm audit gate: ${error.message}`);
    if (code === 2) {
      console.error(
        "   This is NOT a report of a vulnerability — the gate never reached a verdict.\n" +
          noVerdictHint(error),
      );
    }
    // NOT process.exit(): it discards queued writes on a piped stdout/stderr,
    // and the truncation starts from the end — so the first casualty is the
    // explainer immediately above, which is the one thing this split exists to
    // deliver. Setting exitCode lets Node drain and exit on its own.
    process.exitCode = code;
  });
}
