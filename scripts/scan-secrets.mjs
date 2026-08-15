#!/usr/bin/env node

/**
 * gitleaks wrapper shared by the pre-commit hook, `npm run ci:local-gate`, and
 * the CI `secret-scan` job. Resolves a single pinned gitleaks binary and runs the
 * mode-appropriate scan against the repo-root .gitleaks.toml. Exits non-zero when
 * a secret is found (gitleaks default `--exit-code 1`).
 *
 * Modes (argv):
 *   --staged                   scan staged changes only (pre-commit)
 *   --base <sha> --head <sha>  scan the base..head commit range (CI / local gate)
 *   (none)                     scan every ref's full history (audit) — requires a
 *                              complete clone; a shallow one silently under-reports
 *
 * Flags:
 *   --soft-missing  when the gitleaks binary can't be found/installed, print
 *                   install guidance and exit 0 instead of failing. The local hook
 *                   and gate pass this so an offline dev isn't hard-blocked; CI
 *                   omits it so a missing scanner is a hard error.
 *
 * Docs: docs/internal/ci-cd/SECRET_SCANNING.md
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = join(ROOT, ".gitleaks.toml");
const BASELINE_PATH = join(ROOT, ".gitleaks-baseline.json");
const CACHED_BIN = join(ROOT, ".cache", "gitleaks", "gitleaks");
const INSTALL_SCRIPT = join(ROOT, "scripts", "install-gitleaks.sh");

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  // Guard against a following flag being swallowed as this flag's value (matches the
  // convention in scripts/check-migration-safety.mjs). Commit SHAs never start with "-".
  if (value === undefined || value.startsWith("-")) return undefined;
  return value;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

/**
 * Build the gitleaks argv (pure — unit-tested). Run from the repo root.
 * @param {{mode:"staged"|"range"|"full", base?:string, head?:string, configPath:string, baselinePath?:string}} opts
 */
export function buildGitleaksArgs({ mode, base, head, configPath, baselinePath }) {
  const args = ["git", "--no-banner", "--redact", "-c", configPath];
  if (baselinePath) {
    args.push("--baseline-path", baselinePath);
  }
  if (mode === "staged") {
    // Scan the staged diff (git index) — fast, pre-commit oriented.
    args.push("--pre-commit", "--staged");
  } else if (mode === "range") {
    // Scan only the commits introduced by head relative to base.
    args.push(`--log-opts=${base}..${head}`);
  } else {
    // mode "full": every ref, not just the checked-out branch. Bare `gitleaks git`
    // walks HEAD's ancestry only, so a secret committed to a branch that was never
    // merged is invisible to it — on this repo that was 481 commits scanned out of
    // 1087. `--all` is what makes this an audit of the repository rather than of
    // one branch. Note this needs a complete clone: in a shallow checkout git can
    // only walk the commits present, so an audit run there under-reports. See
    // docs/internal/ci-cd/SECRET_SCANNING.md.
    args.push("--log-opts=--all");
  }
  return args;
}

/**
 * gitleaks' `git --pre-commit --staged` / `--log-opts` interface needs gitleaks >= 8.19
 * (the `git`/`dir`/`stdin` subcommand split). Used to vet a PATH fallback binary so an
 * older system/Homebrew gitleaks isn't driven with flags it doesn't understand.
 */
function isCompatibleGitleaks(versionOutput) {
  const match = /(\d+)\.(\d+)/.exec(String(versionOutput));
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 8 || (major === 8 && minor >= 19);
}

/** Is `rev` an object present in this repo, so a `<rev>..HEAD` range is valid? */
function isReachable(rev) {
  const result = spawnSync("git", ["cat-file", "-e", `${rev}^{commit}`], {
    cwd: ROOT,
    stdio: "ignore",
  });
  return !result.error && result.status === 0;
}

function resolveBinary() {
  // The pinned binary in .cache/ is the source of truth — it keeps local and CI in lockstep.
  // install-gitleaks.sh is idempotent (a fast version check when already cached), so a
  // GITLEAKS_VERSION bump takes effect everywhere without a manual re-install. stdout is
  // suppressed to keep per-commit output quiet; stderr still surfaces real download errors.
  const install = spawnSync("bash", [INSTALL_SCRIPT], { stdio: ["ignore", "ignore", "inherit"] });
  if (install.status === 0 && existsSync(CACHED_BIN)) return CACHED_BIN;

  // Installer exited non-zero — offline, no bash, or a checksum error (see its stderr). Fall back to a
  // COMPATIBLE gitleaks on PATH so an offline dev isn't hard-blocked. In CI there's no gitleaks on PATH,
  // so this returns null below and the scan hard-fails — a failed pinned install never silently passes.
  const probe = spawnSync("gitleaks", ["version"], { encoding: "utf8" });
  if (!probe.error && probe.status === 0 && isCompatibleGitleaks(probe.stdout)) {
    return "gitleaks";
  }

  return null;
}

function main() {
  const soft = hasFlag("--soft-missing");

  let mode = "full";
  let base;
  let head;
  if (hasFlag("--staged")) {
    mode = "staged";
  } else if (hasFlag("--base") || hasFlag("--head")) {
    base = getArg("--base");
    head = getArg("--head");
    if (!base || !head) {
      console.error("scan-secrets: --base and --head are both required for a range scan.");
      process.exit(2);
    }
    // No usable predecessor — the all-zero new-branch sentinel, or a rewritten/unreachable
    // SHA (e.g. a force-push `before`) — has no valid `base..head` range, so scan full history
    // instead of letting `git log <bad>..<head>` die with exit 128.
    mode = /^0+$/.test(base) || !isReachable(base) ? "full" : "range";
  }

  const bin = resolveBinary();
  if (!bin) {
    const guidance =
      "gitleaks not found and could not be installed.\n" +
      "  Install it with:  bash scripts/install-gitleaks.sh   (or: brew install gitleaks)";
    if (soft) {
      console.warn(`⚠️  ${guidance}\n  Skipping local secret scan — CI still enforces it.`);
      process.exit(0);
    }
    console.error(`❌ ${guidance}`);
    process.exit(1);
  }

  const args = buildGitleaksArgs({
    mode,
    base,
    head,
    configPath: CONFIG_PATH,
    baselinePath: existsSync(BASELINE_PATH) ? BASELINE_PATH : undefined,
  });

  const result = spawnSync(bin, args, { cwd: ROOT, stdio: "inherit" });
  if (result.error) {
    console.error(`scan-secrets: failed to run gitleaks: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(
      "\n❌ gitleaks found potential secrets (or errored) above.\n" +
        "  If it's a real secret: remove it from the diff and rotate it.\n" +
        "  If it's a false positive: add a tight entry to .gitleaks.toml [allowlist]\n" +
        "  or an inline `gitleaks:allow` comment. See docs/internal/ci-cd/SECRET_SCANNING.md.",
    );
    // result.status is null when gitleaks was signal-killed (OOM/SIGTERM); treat that as a
    // failure, never a pass (process.exit(null) would coerce to 0 and falsely report clean).
    process.exit(result.status ?? 1);
  }
  console.log("✅ gitleaks: no secrets found.");
}

// Run only when invoked directly, so tests can import buildGitleaksArgs cleanly.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
