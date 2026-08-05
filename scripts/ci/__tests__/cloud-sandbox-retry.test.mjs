import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Tests for the cs_retry / cs_classify_failure helpers in scripts/lib/cloud-sandbox-common.sh —
// shell, not a JS module, so this drives bash as a subprocess. Placement follows
// review-gate.test.mjs in this directory: the `test:ci-scripts` glob
// (scripts/ci/__tests__/*.test.mjs) and the ci-scripts-tests CI job pick it up automatically,
// whereas a test parked next to the script would never be run by anything and would rot.
//
// What is deliberately NOT tested here: `cs_supabase start` end to end. That needs a Docker
// daemon and ~10 image pulls, and no CI job in this repo starts one. The retry LOGIC is the part
// that can silently regress — a classifier that stops recognising a CDN 503 fails open into
// exactly the session-killing behaviour this code exists to prevent, and nothing else would
// notice until a real outage.
const LIB = fileURLToPath(new URL("../../lib/cloud-sandbox-common.sh", import.meta.url));

// Every case sources the lib in a fresh bash. FRAPP_SANDBOX_RETRY_BASE_DELAY=0 removes the
// backoff sleeps so the suite runs in milliseconds instead of ~30s per retry case — which is the
// concrete reason that knob is configurable rather than hardcoded.
function bash(script, env = {}) {
  return spawnSync("bash", ["-c", `set -uo pipefail\n. '${LIB}'\n${script}`], {
    encoding: "utf8",
    env: { ...process.env, FRAPP_SANDBOX_RETRY_BASE_DELAY: "0", ...env },
  });
}

// The classifier reads a FILE, so each case writes its fixture to one. Passing text on argv
// would not exercise the grep-over-file path the real caller uses.
function classify(logText) {
  const dir = mkdtempSync(path.join(tmpdir(), "cs-classify-"));
  const cap = path.join(dir, "capture.log");
  writeFileSync(cap, logText);
  try {
    const res = bash(`cs_classify_failure '${cap}'`);
    assert.equal(res.status, 0, `classifier exited ${res.status}: ${res.stderr}`);
    return res.stdout.trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─── cs_classify_failure ──────────────────────────────────────────────────────────────────

test("classifies transient registry/CDN errors as retryable", () => {
  // Strings drawn from the shapes docker/the Supabase CLI actually emit, not invented ones.
  const transient = {
    "cloudfront 503": "failed to pull: received unexpected HTTP status: 503 Service Unavailable",
    "bare 502": "Error response from daemon: 502 Bad Gateway",
    "504 gateway": "unexpected status from GET request: 504 Gateway Timeout",
    "connection reset": "read tcp 10.0.0.2:443: read: connection reset by peer",
    "truncated transfer": "error pulling image configuration: unexpected EOF",
    "i/o timeout": "dial tcp 99.84.0.1:443: i/o timeout",
    "tls handshake": "net/http: TLS handshake timeout",
    "deadline": "context deadline exceeded (Client.Timeout exceeded while awaiting headers)",
  };
  for (const [label, text] of Object.entries(transient)) {
    assert.equal(classify(text), "transient", `${label} should be retryable`);
  }
});

test("classifies allowlist and rate-limit failures as fatal", () => {
  assert.equal(
    classify("Get https://public.ecr.aws/v2/supabase/postgres/blobs/sha256:ab: 403 Host not in allowlist"),
    "policy",
  );
  assert.equal(classify("error pulling image: denied by policy"), "policy");
  assert.equal(
    classify("toomanyrequests: You have reached your pull rate limit. Increase the limit"),
    "ratelimit",
  );
  assert.equal(classify("Error response from daemon: Rate exceeded"), "ratelimit");
});

test("a blocked PostHog telemetry call is NOT a policy failure", () => {
  // The single subtlest correctness risk in this code. The Supabase CLI's telemetry call is
  // rejected with the IDENTICAL "403 Host not in allowlist" wording as a blocked image pull, but
  // it is harmless — it was the red herring in the original incident diagnosis. A classifier that
  // matched it would abort bringup on noise, i.e. exactly invert the fix.
  assert.equal(
    classify("posthog: Post https://us.i.posthog.com/batch/: 403 Host not in allowlist"),
    "unknown",
    "telemetry noise alone must not be classified as a fatal policy failure",
  );

  // ...and it must not mask a real transient failure that appears alongside it, which is the
  // exact log the incident produced.
  assert.equal(
    classify(
      [
        "posthog: Post https://us.i.posthog.com/batch/: 403 Host not in allowlist",
        "failed to pull supabase/postgres: 503 Service Unavailable",
      ].join("\n"),
    ),
    "transient",
  );
});

test("fatal classes win over transient noise in the same log", () => {
  // A blocked pull usually ALSO logs a 5xx or a reset as the connection dies. Matching transient
  // first would retry an unfixable misconfiguration to exhaustion and still fail.
  assert.equal(
    classify(["Host not in allowlist: public.ecr.aws", "503 Service Unavailable during teardown"].join("\n")),
    "policy",
  );
  assert.equal(
    classify(["toomanyrequests: pull rate limit", "connection reset by peer"].join("\n")),
    "ratelimit",
  );
});

test("incidental digits in pull output are not read as HTTP statuses", () => {
  // Regression: the patterns were once bare `\b429\b` / `\b50[234]\b`. `.` is a word boundary, so
  // they matched Docker's progress lines AND Supabase image tags — and since `ratelimit` is
  // fail-fast and tested before `transient`, one incidental number turned a retryable CDN outage
  // into an immediate abort telling the user to add Docker Hub credentials that cannot help.
  // gotrue was at v2.193.0 when this was written, so v2.429.0 is a matter of time, not fiction.
  assert.equal(
    classify(["v2.429.0: Pulling from supabase/gotrue", "failed to pull: 503 Service Unavailable"].join("\n")),
    "transient",
  );
  assert.equal(
    classify(["a1b2: Downloading 429.5MB/1.2GB", "read tcp: connection reset by peer"].join("\n")),
    "transient",
  );
  assert.equal(
    classify(["v2.502.1: Pulling from supabase/realtime", "error setting rlimit type 7: operation not permitted"].join("\n")),
    "deterministic",
  );
  // Real HTTP context must still be recognised when the phrase form is absent.
  assert.equal(classify("received unexpected HTTP status 429"), "ratelimit");
  assert.equal(classify("registry responded with status: 503"), "transient");
});

test("a bare registry 403 is retryable; only the proxy's allowlist marker is fatal", () => {
  // ECR Public redirects blobs to short-lived presigned CloudFront URLs. On the ~1GB postgres
  // image — precisely this feature's workload — a slow pull can outlive the signature and get a
  // 403 that IS retryable. Matching bare `403 Forbidden` as a policy failure aborted on it and
  // told the user to widen a network policy that was already correct.
  assert.equal(
    classify("unexpected status from GET request to https://d123.cloudfront.net/v2/blob: 403 Forbidden"),
    "unknown",
    "a bare 403 must not be treated as a fatal allowlist rejection",
  );
  assert.equal(
    classify("Get https://public.ecr.aws/v2/: 403 Host not in allowlist"),
    "policy",
    "the proxy's own marker must still be fatal",
  );
});

test("classification survives a realistically large capture", () => {
  // Regression for a silent, size-dependent failure: the tests were `printf ... | grep -q`, and
  // grep -q exits at the first match, SIGPIPEing the printf behind it. Under the callers'
  // `set -o pipefail` the pipeline then reports 141 and the matching branch is SKIPPED. Below
  // ~64KiB it never reproduces, and every real `supabase start` log is far bigger — so the
  // fail-fast half degraded to `unknown` exactly where it mattered. Small fixtures cannot catch
  // this; the size is the test.
  const noise = "a1b2c3d4: Downloading [====>   ] 128.5MB/1.2GB\n".repeat(8000);
  assert.ok(noise.length > 300_000, "fixture must exceed the ~64KiB SIGPIPE threshold");
  assert.equal(classify(`Get https://public.ecr.aws/v2/: 403 Host not in allowlist\n${noise}`), "policy");
  assert.equal(classify(`${noise}\ntoomanyrequests: pull rate limit exceeded`), "ratelimit");
  assert.equal(classify(`${noise}\nfailed to pull: 503 Service Unavailable`), "transient");
});

test("deterministic local failures are fatal rather than retried", () => {
  // Each of these already has a row in CLOUD_SANDBOX.md's symptom table. Retrying one just reruns
  // a ~90s start to reach the same error and then reports "no known pattern" — losing a diagnosis
  // the repo already had written down.
  for (const [label, text] of Object.entries({
    "edge-runtime rlimit": "failed to start docker container: error setting rlimit type 7: operation not permitted",
    "port conflict": "Error starting userland proxy: port is already allocated",
    "dockerd down": "Cannot connect to the Docker daemon at unix:///var/run/docker.sock",
    "poisoned volume": "FATAL: database files are incompatible with server",
  })) {
    assert.equal(classify(text), "deterministic", label);
  }
});

test("unrecognised output and a missing capture file fall back to unknown", () => {
  assert.equal(classify("something nobody has ever seen before"), "unknown");
  assert.equal(classify(""), "unknown");
  assert.equal(bash("cs_classify_failure /nonexistent/path").stdout.trim(), "unknown");
  assert.equal(bash("cs_classify_failure").stdout.trim(), "unknown");
});

test("every class carries a non-empty, actionable hint", () => {
  for (const cls of ["policy", "ratelimit", "transient", "toolchain", "wat"]) {
    const hint = bash(`cs_failure_hint ${cls}`).stdout.trim();
    assert.ok(hint.length > 20, `${cls} hint is too short to act on: ${hint}`);
  }
  // The two fixable classes must name the actual remedy — this string is what lands in
  // .cloud-sandbox-up.failed and is the only thing a polling agent reads.
  assert.match(bash("cs_failure_hint policy").stdout, /Network = Full|public\.ecr\.aws/);
  assert.match(bash("cs_failure_hint ratelimit").stdout, /DOCKERHUB_TOKEN/);
});

// ─── cs_retry ─────────────────────────────────────────────────────────────────────────────

// The retried command runs on the left-hand side of a pipeline (it is piped into `tee`), so it
// executes in a SUBSHELL and cannot report attempt counts through a shell variable. Count via a
// file instead — the same reason the production caller keeps no state in the retried command.
function retryHarness({ script, env = {} } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "cs-retry-"));
  const counter = path.join(dir, "attempts");
  writeFileSync(counter, "0");
  try {
    // A private TMPDIR per run is what makes `leaked` below meaningful: cs_retry mktemps its
    // per-attempt capture file there, so anything left over is a leak this run caused.
    const res = bash(
      `COUNTER='${counter}'
       bump() { printf '%s' "$(( $(cat "$COUNTER") + 1 ))" >"$COUNTER"; cat "$COUNTER"; }
       ${script}`,
      { TMPDIR: dir, ...env },
    );
    const leaked = readdirSync(dir).filter((f) => f.startsWith("cloud-sandbox-retry."));
    return { res, attempts: Number(readFileSync(counter, "utf8")), leaked };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("retries a transient failure and reports success once it recovers", () => {
  const { res, attempts } = retryHarness({
    script: `
      flaky() {
        n=$(bump)
        [ "$n" -lt 3 ] && { echo "503 Service Unavailable"; return 1; }
        echo "Started supabase local development setup."; return 0
      }
      cs_retry "flaky" "" flaky >/dev/null 2>&1
      echo "rc=$? class=[\${CS_RETRY_CLASS}]"`,
  });
  assert.equal(attempts, 3, "should have kept trying until it recovered");
  assert.match(res.stdout, /rc=0/);
  // A recovered call must not leave failure state behind for the caller to misread as a failure.
  assert.match(res.stdout, /class=\[\]/, "class must be cleared on success");
});

test("stops at the attempt budget when the failure never clears", () => {
  const { res, attempts } = retryHarness({
    script: `
      never() { bump >/dev/null; echo "connection reset by peer"; return 1; }
      cs_retry "never" "" never >/dev/null 2>&1
      echo "rc=$? class=\${CS_RETRY_CLASS}"`,
  });
  assert.equal(attempts, 3, "default budget is 3 attempts");
  assert.match(res.stdout, /rc=1/);
  assert.match(res.stdout, /class=transient/);
});

test("FRAPP_SANDBOX_START_RETRIES changes the budget", () => {
  const { attempts } = retryHarness({
    script: `never() { bump >/dev/null; echo 503; return 1; }
             cs_retry "never" "" never >/dev/null 2>&1`,
    env: { FRAPP_SANDBOX_START_RETRIES: "5" },
  });
  assert.equal(attempts, 5);
});

test("fatal classifications fail fast after exactly one attempt", () => {
  // This is the "no wasted retries" half of the fix. Each of these costs ~90s per wasted attempt
  // against a problem no retry can solve.
  for (const [label, output, expected] of [
    ["allowlist", "403 Host not in allowlist", "policy"],
    ["rate limit", "toomanyrequests: rate exceeded", "ratelimit"],
  ]) {
    const { res, attempts } = retryHarness({
      script: `fatal() { bump >/dev/null; echo "${output}"; return 1; }
               cs_retry "fatal" "" fatal >/dev/null 2>&1
               echo "class=\${CS_RETRY_CLASS}|hint=\${CS_RETRY_HINT}"`,
    });
    assert.equal(attempts, 1, `${label} must not be retried`);
    assert.match(res.stdout, new RegExp(`class=${expected}\\|hint=.+`), `${label} must carry a hint`);
  }
});

test("the per-attempt capture file never leaks, on any return path", () => {
  // It is mktemp'd once per cs_retry call; the SessionStart hook relaunches bringup on every
  // resume, so a persistently failing environment would otherwise drip one orphan per cycle onto
  // a disk shared with the Docker image cache.
  const cases = {
    success: `ok() { bump >/dev/null; echo fine; return 0; }; cs_retry x "" ok`,
    "budget exhausted": `t() { bump >/dev/null; echo "503 Service Unavailable"; return 1; }; cs_retry x "" t`,
    "fatal policy": `p() { bump >/dev/null; echo "Host not in allowlist"; return 1; }; cs_retry x "" p`,
    "fatal deterministic": `d() { bump >/dev/null; echo "error setting rlimit type 7"; return 1; }; cs_retry x "" d`,
    toolchain: `b() { bump >/dev/null; echo nope; return 127; }; cs_retry x "" b`,
  };
  for (const [label, script] of Object.entries(cases)) {
    const { leaked } = retryHarness({ script: `${script} >/dev/null 2>&1` });
    assert.deepEqual(leaked, [], `${label} leaked a capture file: ${leaked.join(", ")}`);
  }
});

test("an unusable TMPDIR fails loudly instead of silently classifying everything unknown", () => {
  // Unchecked, the empty mktemp result made cs_classify_failure hit its unreadable-file guard and
  // answer `unknown` for every attempt — so policy and ratelimit stopped being detected at all and
  // were retried to exhaustion, while `tee ''` sprayed errors naming the wrong file.
  const res = bash(
    `p() { echo "Host not in allowlist"; return 1; }
     cs_retry x "" p >/dev/null
     echo "rc=$? class=\${CS_RETRY_CLASS}"`,
    { TMPDIR: "/nonexistent-tmpdir-for-tests" },
  );
  assert.match(res.stdout, /rc=1/);
  assert.match(res.stdout, /class=toolchain/, "must report the real problem, not misclassify");
  assert.match(res.stderr, /cannot create a capture file/);
});

test("a toolchain failure (exit 127) is never retried", () => {
  // cs_supabase returns 127 for its own install failures — a bad version pin or a blocked npm
  // registry. Retrying only repeats a failing `npm install`. Note the fixture ALSO contains a 503,
  // to prove the exit code is checked before the output is classified.
  const { res, attempts } = retryHarness({
    script: `broken() { bump >/dev/null; echo "503 Service Unavailable"; return 127; }
             cs_retry "broken" "" broken >/dev/null 2>&1
             echo "rc=$? class=\${CS_RETRY_CLASS}"`,
  });
  assert.equal(attempts, 1);
  assert.match(res.stdout, /rc=127/);
  assert.match(res.stdout, /class=toolchain/);
});

test("the cleanup command runs between attempts, but not after the last one", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cs-cleanup-"));
  const marks = path.join(dir, "cleanups");
  writeFileSync(marks, "");
  try {
    // Without this, a retried `supabase start` runs over the half-created containers the failed
    // attempt left behind and fails for a different reason than the one being retried.
    bash(`stub_cleanup() { printf 'x' >>'${marks}'; }
          never() { echo "503 Service Unavailable"; return 1; }
          cs_retry "never" "stub_cleanup" never >/dev/null 2>&1`);
    assert.equal(
      readFileSync(marks, "utf8").length,
      2,
      "3 attempts means 2 gaps — a cleanup after the final failure would be wasted work",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("non-integer retry knobs fall back to defaults instead of aborting the shell", () => {
  // Both knobs feed $(( )), which kills the shell on a non-integer — that would turn a tuning
  // variable into a way to break bringup outright.
  const res = bash("echo attempts=$CS_RETRY_ATTEMPTS delay=$CS_RETRY_BASE_DELAY", {
    FRAPP_SANDBOX_START_RETRIES: "abc",
    FRAPP_SANDBOX_RETRY_BASE_DELAY: "-5s",
  });
  assert.equal(res.status, 0, `sourcing should not fail: ${res.stderr}`);
  assert.match(res.stdout, /attempts=3 delay=10/);

  const zero = bash("echo attempts=$CS_RETRY_ATTEMPTS", { FRAPP_SANDBOX_START_RETRIES: "0" });
  assert.match(zero.stdout, /attempts=1/, "0 attempts would run nothing at all; floor it at 1");
});

// ─── wiring the call sites depend on ──────────────────────────────────────────────────────

test("CLI telemetry is disabled by sourcing the lib", () => {
  const res = bash("echo t=$SUPABASE_TELEMETRY_DISABLED d=$DO_NOT_TRACK");
  assert.match(res.stdout, /t=1 d=1/);
});

test("both call sites pass the start args unquoted", () => {
  // Quoting $CS_SUPABASE_START_ARGS collapses `-x edge-runtime` into a single argument, silently
  // un-doing the exclusion — which aborts `supabase start` outright in this sandbox. It is a
  // one-character regression with no local symptom, so pin it here.
  for (const script of ["cloud-sandbox-up.sh", "cloud-sandbox-setup.sh"]) {
    const src = readFileSync(fileURLToPath(new URL(`../../${script}`, import.meta.url)), "utf8");
    assert.match(
      src,
      /# shellcheck disable=SC2086\ncs_retry "[^"]+" "cs_supabase stop" cs_supabase start \$CS_SUPABASE_START_ARGS/,
      `${script} must call cs_retry with an unquoted $CS_SUPABASE_START_ARGS and keep its SC2086 directive`,
    );
  }
});
