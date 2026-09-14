import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guards the failure class that took out `scripts/cloud-sandbox-egress-probe.sh` for four
 * days (#2205, introduced by #2110).
 *
 * That script embedded its Python manifest builder as a single-quoted bash word
 * (`python3 -c '…'`). A docs edit inside the Python rewrote one warning string to read
 * `this session's environment dashboard`; the apostrophe closed the bash quote and the
 * rest of the file was parsed as shell. The whole script became unparseable — and because
 * a parse error kills a file before any command in it runs, the script's own
 * `|| { cs_log "WARN: …"; }` guard never fired. Bringup invoked it as
 * `bash … >/dev/null || true`, so nothing surfaced anywhere. Every cloud session ran with
 * no `.cloud-sandbox-capabilities.json` while four docs told agents to read it.
 *
 * Two assertions, because the second is what makes the first durable:
 *   1. every tracked shell script parses;
 *   2. the probe keeps its builder in a QUOTED heredoc, which is opaque to bash, so no
 *      future prose edit inside the Python can reach the shell parser at all.
 */

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const PROBE = join(repoRoot, "scripts", "cloud-sandbox-egress-probe.sh");

function trackedShellScripts() {
  const out = execFileSync("git", ["ls-files", "-z", "*.sh"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return out.split("\0").filter(Boolean);
}

test("every tracked shell script parses", () => {
  const scripts = trackedShellScripts();
  // A discovery bug that silently matched nothing would make this suite pass forever.
  assert.ok(scripts.length > 5, `expected to find shell scripts, found ${scripts.length}`);

  const broken = [];
  for (const rel of scripts) {
    const result = spawnSync("bash", ["-n", rel], { cwd: repoRoot, encoding: "utf8" });
    if (result.status !== 0) broken.push(`${rel}: ${(result.stderr || "").trim()}`);
  }
  assert.deepEqual(broken, [], `shell scripts failed \`bash -n\`:\n${broken.join("\n")}`);
});

test("the egress probe keeps its Python builder in a quoted heredoc, not `python3 -c '…'`", () => {
  const src = readFileSync(PROBE, "utf8");
  assert.match(
    src,
    /cat >"\$BUILDER" <<'PY'/,
    "builder must be written via a single-quoted heredoc, which bash does not scan for quotes",
  );
  // Comments are stripped first: the script explains this hazard in prose, and that prose
  // necessarily quotes the very form it warns against.
  const code = src
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  assert.doesNotMatch(
    code,
    /python3 -c '/,
    "inlining the builder as a single-quoted bash word is what #2205 was — an apostrophe in the Python breaks the whole file",
  );
  // The apostrophe that caused #2205. It must still be there, and still be harmless:
  // the acceptance criteria on #2205 explicitly forbid 'fixing' this by rewording.
  assert.ok(
    src.includes("this session's environment dashboard"),
    "the SECURITY warning wording from #2110 must be preserved verbatim",
  );
});

// ── End-to-end, with curl stubbed ────────────────────────────────────────────────────
// The SECURITY branch (a production host answering) has never executed in any session:
// it was inside the dead region from the day the probe landed. Parsing is not evidence it
// works, so drive the real script over a fake curl and assert on the manifest it writes.

function runProbeWithStubbedCurl(prodReachable) {
  const dir = mkdtempSync(join(tmpdir(), "egress-probe-"));
  const bin = join(dir, "bin");
  execFileSync("mkdir", ["-p", bin]);

  const prodBehaviour = prodReachable ? "printf '404'; exit 0" : "printf '000'; exit 56";
  const stub = join(bin, "curl");
  writeFileSync(
    stub,
    `#!/usr/bin/env bash\nurl="\${!#}"\ncase "$url" in\n` +
      `  *//api.frapp.live/*|*//app.frapp.live*|*unttyvyfezddlyafcydh*) ${prodBehaviour} ;;\n` +
      `  *) printf '200'; exit 0 ;;\nesac\n`,
  );
  chmodSync(stub, 0o755);

  const result = spawnSync("bash", [PROBE], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, PATH: `${bin}:${process.env.PATH}` },
  });
  const manifestPath = join(dir, ".cloud-sandbox-capabilities.json");
  return { result, manifest: JSON.parse(readFileSync(manifestPath, "utf8")) };
}

test("probe writes the documented manifest shape and exits 0", () => {
  const { result, manifest } = runProbeWithStubbedCurl(false);

  // "NEVER FATAL, and never non-zero" — bringup reaches `.done` through this script.
  assert.equal(result.status, 0, `probe must never exit non-zero (stderr: ${result.stderr})`);

  for (const key of ["generated_at", "summary", "staging_reachable", "hosts", "warnings"]) {
    assert.ok(key in manifest, `manifest must carry \`${key}\``);
  }
  assert.equal(manifest.warnings.length, 0, "a healthy environment produces no warnings");
  assert.equal(manifest.hosts.length, 7, "four staging hosts plus three production assertions");
  assert.ok(
    manifest.summary.startsWith("EGRESS: deployed staging reachable"),
    `unexpected summary: ${manifest.summary}`,
  );
  // live-verification/SKILL.md tells agents to resolve the staging Supabase ref by this
  // exact label rather than typing a `supabase.co` host from memory. It is load-bearing.
  const supabase = manifest.hosts.find((h) => h.key === "staging_supabase");
  assert.equal(supabase.label, "frapp-staging Supabase");
  assert.ok(supabase.url.includes("hnoyzpidbmizhbqaiity"), "must point at the staging project ref");
});

test("a reachable production host raises a SECURITY warning, not extra capability", () => {
  const { result, manifest } = runProbeWithStubbedCurl(true);

  assert.equal(result.status, 0, "a security finding still must not fail bringup");
  const security = manifest.warnings.filter((w) => w.startsWith("SECURITY:"));
  assert.ok(security.length > 0, `expected a SECURITY warning, got: ${JSON.stringify(manifest.warnings)}`);
  assert.match(security[0], /is REACHABLE \(HTTP 404\) and must not be/);
  assert.match(security[0], /regressed to a wildcard/);
  assert.equal(
    manifest.summary,
    "EGRESS: production is reachable -- allowlist regression, see warnings",
    "the summary must lead with the regression, not with staging being fine",
  );
  // The prod hosts must be marked failed, never folded into the success lists.
  const prod = manifest.hosts.filter((h) => h.expected === "blocked");
  assert.ok(prod.some((h) => h.ok === false), "a reachable prod host is ok:false");
  assert.equal(
    manifest.production_blocked_as_expected.includes("PRODUCTION Supabase"),
    false,
    "a host that answered must not be listed as correctly blocked",
  );
});

// ── The manifest is unconditional ────────────────────────────────────────────────────
// Absence, not the syntax error, was the harm in #2205: four docs tell agents to read this
// file INSTEAD of probing by hand and frame its absence as impossible, so a session that
// finds nothing has no sanctioned reading of what it is looking at. The probe therefore
// writes a DEGRADED manifest on every failure path. These tests pin that, and pin that the
// degraded one cannot be mistaken for a result.

const MANIFEST_KEYS = [
  "docs",
  "generated_at",
  "hosts",
  "probe_ok",
  "production_blocked_as_expected",
  "skill",
  "staging_reachable",
  "summary",
  "warnings",
];

function runProbeIn(dir, env) {
  // /bin/bash by absolute path: some cases below deliberately run without a usable PATH.
  const result = spawnSync("/bin/bash", [PROBE], {
    cwd: dir,
    encoding: "utf8",
    env: { CLAUDE_PROJECT_DIR: dir, ...env },
  });
  const raw = readFileSync(join(dir, ".cloud-sandbox-capabilities.json"), "utf8");
  return { result, manifest: JSON.parse(raw) };
}

test("a probe that cannot run still writes a parseable manifest, marked UNKNOWN", () => {
  const dir = mkdtempSync(join(tmpdir(), "egress-degraded-"));
  // No PATH at all: mktemp, curl, sed, cat and date are all unreachable. This is the
  // harshest failure the script can meet, and the one where `write_unknown_manifest` has
  // nothing but bash builtins to work with.
  const { result, manifest } = runProbeIn(dir, { PATH: "/nonexistent" });

  assert.equal(result.status, 0, "never non-zero, even with no usable PATH");
  assert.deepEqual(Object.keys(manifest).sort(), MANIFEST_KEYS, "degraded manifest must carry the same keys as a real one");
  assert.equal(manifest.probe_ok, false);
  assert.deepEqual(manifest.hosts, []);
  assert.deepEqual(manifest.staging_reachable, []);
  assert.match(
    manifest.generated_at,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
    "timestamp comes from the printf builtin under TZ=UTC, so it must still be well-formed UTC",
  );
});

test("an UNKNOWN manifest reads as unknown, never as 'staging is blocked'", () => {
  const dir = mkdtempSync(join(tmpdir(), "egress-degraded-"));
  const { manifest } = runProbeIn(dir, { PATH: "/nonexistent" });

  // The empty `staging_reachable` above is the dangerous field: it is shaped exactly like
  // "nothing was reachable". The prose is what stops it being read that way, so assert on it.
  assert.match(manifest.summary, /capability UNKNOWN/);
  assert.equal(manifest.warnings.length, 1);
  // Asserted over summary + warnings together: session-start.sh renders them back-to-back,
  // so what matters is that a reader sees all three disclaimers, not which field carries
  // each one. Pinning them per-field would just make a wording move look like a regression.
  const shown = [manifest.summary, ...manifest.warnings].join(" ");
  assert.match(shown, /nothing was verified/);
  assert.match(shown, /NOT evidence that staging is blocked/);
  assert.match(shown, /NOT evidence that production is unreachable/);
  assert.match(shown, /production-is-unreachable assertion did NOT run/);
  // …and that neither field pads the other out by restating it.
  assert.equal(
    manifest.warnings[0].includes(manifest.summary),
    false,
    "the warning must not restate the summary — the hook prints both",
  );

  // session-start.sh gates its "live checks are available" nudge on a CLEAN manifest —
  // reachable hosts AND no warnings. A degraded manifest must never satisfy it.
  const nudgeWouldFire = manifest.staging_reachable.length > 0 && manifest.warnings.length === 0;
  assert.equal(nudgeWouldFire, false, "the hook must not advertise live checks off an UNKNOWN manifest");
});

test("a successful probe marks probe_ok true and carries the same key set", () => {
  const dir = mkdtempSync(join(tmpdir(), "egress-ok-"));
  const bin = join(dir, "bin");
  execFileSync("mkdir", ["-p", bin]);
  const stub = join(bin, "curl");
  writeFileSync(stub, "#!/usr/bin/env bash\nprintf '200'\nexit 0\n");
  chmodSync(stub, 0o755);

  const { result, manifest } = runProbeIn(dir, { PATH: `${bin}:${process.env.PATH}` });
  assert.equal(result.status, 0);
  assert.equal(manifest.probe_ok, true);
  assert.deepEqual(Object.keys(manifest).sort(), MANIFEST_KEYS, "success and degraded manifests must be shape-compatible");
});

test("bringup surfaces a probe that fails instead of swallowing it", () => {
  // `bash … >/dev/null || true` reported neither the exit code nor the syntax error for
  // four days. Pin the three signals that replaced it.
  const src = readFileSync(join(repoRoot, "scripts", "cloud-sandbox-up.sh"), "utf8");
  assert.doesNotMatch(
    src,
    /cloud-sandbox-egress-probe\.sh" >\/dev\/null \|\| true/,
    "the probe invocation must not discard its exit status again",
  );
  assert.match(src, /egress_rc=\$\?/, "bringup must capture the probe's exit code");
  assert.match(src, /cat "\$egress_err" >&2/, "bringup must replay the probe's stderr into the bringup log");
  assert.match(
    src,
    /if \[ ! -s "\$ROOT\/\.cloud-sandbox-capabilities\.json" \]; then/,
    "bringup must warn when no manifest was produced at all",
  );
});
