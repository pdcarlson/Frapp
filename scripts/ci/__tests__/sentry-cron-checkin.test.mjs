import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MONITORS,
  checkInPayload,
  checkInQuery,
  checkInUrlFor,
  sendCheckIn,
} from "../sentry-cron-checkin.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DSN = "https://abc123publickey@o4509000000000000.ingest.us.sentry.io/4509111111111111";
const CHECK_IN_ID = "8f7c5e1a-3b2d-4c6e-9a1f-0e2d3c4b5a69";
const noSleep = async () => {};

function quietLogger() {
  const warnings = [];
  const logs = [];
  return {
    warnings,
    logs,
    warn: (message) => warnings.push(message),
    log: (message) => logs.push(message),
  };
}

function fetchStub(responses) {
  const calls = [];
  let index = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (next instanceof Error) throw next;
    return { ok: next >= 200 && next < 300, status: next };
  };
  return { calls, fetchImpl };
}

describe("checkInUrlFor", () => {
  it("builds the cron endpoint from a DSN", () => {
    assert.equal(
      checkInUrlFor(DSN, "production-db-backup"),
      "https://o4509000000000000.ingest.us.sentry.io/api/4509111111111111/cron/production-db-backup/abc123publickey/",
    );
  });

  it("keeps a DSN's path prefix before /api", () => {
    assert.equal(
      checkInUrlFor("https://key@sentry.example.com/relay/42", "job"),
      "https://sentry.example.com/relay/api/42/cron/job/key/",
    );
  });

  it("rejects what is not a DSN", () => {
    assert.equal(checkInUrlFor("not a url", "job"), null);
    assert.equal(checkInUrlFor("https://o1.ingest.sentry.io/42", "job"), null, "no public key");
    assert.equal(checkInUrlFor("https://key@o1.ingest.sentry.io/", "job"), null, "no project id");
    assert.equal(checkInUrlFor("https://key@o1.ingest.sentry.io/abc", "job"), null, "non-numeric id");
  });
});

describe("checkInQuery", () => {
  it("carries status, check_in_id and environment, the fields the endpoint defines in the query", () => {
    const query = new URLSearchParams(checkInQuery({ status: "ok", checkInId: CHECK_IN_ID }));
    assert.deepEqual(Object.fromEntries(query), {
      status: "ok",
      check_in_id: CHECK_IN_ID,
      environment: "production",
    });
  });
});

describe("MONITORS", () => {
  it("keeps every margin under Sentry's cap and inside a day", () => {
    // Sentry rejects a margin over 40,320 minutes (MAX_MARGIN), and a daily
    // job's margin must end before its next expected check-in.
    for (const [slug, monitor] of Object.entries(MONITORS)) {
      assert.ok(monitor.checkinMarginMinutes <= 40_320, slug);
      assert.ok(monitor.checkinMarginMinutes < 24 * 60, slug);
    }
  });
});

describe("checkInPayload", () => {
  it("carries the monitor's schedule as an upsert, in UTC", () => {
    const payload = checkInPayload({
      monitor: MONITORS["production-db-backup"],
      status: "in_progress",
    });
    assert.deepEqual(payload, {
      status: "in_progress",
      monitor_config: {
        schedule: { type: "crontab", value: "30 6 * * *" },
        timezone: "UTC",
        checkin_margin: 720,
        max_runtime: 30,
        failure_issue_threshold: 1,
        recovery_threshold: 1,
      },
    });
  });
});

describe("sendCheckIn", () => {
  it("POSTs the check-in and returns its id", async () => {
    const { calls, fetchImpl } = fetchStub([202]);
    const logger = quietLogger();
    const result = await sendCheckIn({
      dsn: DSN,
      monitorSlug: "production-db-backup",
      status: "ok",
      checkInId: CHECK_IN_ID,
      fetchImpl,
      sleep: noSleep,
      logger,
    });

    assert.deepEqual(result, { sent: true, checkInId: CHECK_IN_ID });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, "POST");
    const sent = new URL(calls[0].url);
    assert.equal(
      `${sent.origin}${sent.pathname}`,
      "https://o4509000000000000.ingest.us.sentry.io/api/4509111111111111/cron/production-db-backup/abc123publickey/",
    );
    assert.equal(sent.searchParams.get("status"), "ok");
    assert.equal(sent.searchParams.get("check_in_id"), CHECK_IN_ID);
    assert.equal(sent.searchParams.get("environment"), "production");
    assert.equal(JSON.parse(calls[0].init.body).status, "ok");
    assert.equal(logger.warnings.length, 0);
  });

  it("never logs the URL, which carries the DSN's public key", async () => {
    const { fetchImpl } = fetchStub([202]);
    const logger = quietLogger();
    await sendCheckIn({
      dsn: DSN,
      monitorSlug: "production-db-backup",
      status: "in_progress",
      fetchImpl,
      sleep: noSleep,
      logger,
    });
    assert.ok(logger.logs.every((line) => !line.includes("abc123publickey")));
  });

  it("mints a check-in id when none is given", async () => {
    const { fetchImpl } = fetchStub([202]);
    const result = await sendCheckIn({
      dsn: DSN,
      monitorSlug: "production-db-backup",
      status: "in_progress",
      fetchImpl,
      sleep: noSleep,
      logger: quietLogger(),
    });
    assert.match(result.checkInId, /^[0-9a-f-]{36}$/);
  });

  it("retries a 5xx with the same check-in id, since the id makes the POST idempotent", async () => {
    const { calls, fetchImpl } = fetchStub([503, 202]);
    const result = await sendCheckIn({
      dsn: DSN,
      monitorSlug: "production-db-backup",
      status: "ok",
      checkInId: CHECK_IN_ID,
      fetchImpl,
      sleep: noSleep,
      logger: quietLogger(),
    });
    assert.equal(result.sent, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, calls[1].url);
    assert.equal(calls[0].init.body, calls[1].init.body);
  });

  for (const [label, overrides, reason] of [
    ["no DSN", { dsn: undefined }, /SENTRY_DSN is not set/],
    ["a malformed DSN", { dsn: "https://o1.ingest.sentry.io/42" }, /not a DSN/],
    ["an unknown monitor", { monitorSlug: "nightly-typo" }, /no monitor named/],
    ["an unknown status", { status: "done" }, /status "done"/],
  ]) {
    it(`warns and sends nothing on ${label}`, async () => {
      const { calls, fetchImpl } = fetchStub([202]);
      const logger = quietLogger();
      const result = await sendCheckIn({
        dsn: DSN,
        monitorSlug: "production-db-backup",
        status: "ok",
        checkInId: CHECK_IN_ID,
        fetchImpl,
        sleep: noSleep,
        logger,
        ...overrides,
      });
      assert.equal(result.sent, false);
      assert.equal(calls.length, 0);
      assert.match(result.reason, reason);
      assert.match(logger.warnings[0], /^::warning::/);
    });
  }

  it("warns rather than throws when Sentry refuses or is unreachable", async () => {
    for (const responses of [[400], [new TypeError("fetch failed")]]) {
      const { fetchImpl } = fetchStub(responses);
      const logger = quietLogger();
      const result = await sendCheckIn({
        dsn: DSN,
        monitorSlug: "production-db-backup",
        status: "error",
        checkInId: CHECK_IN_ID,
        fetchImpl,
        sleep: noSleep,
        logger,
      });
      assert.equal(result.sent, false);
      assert.equal(logger.warnings.length, 1);
    }
  });
});

describe("the CLI", () => {
  const script = path.join(repoRoot, "scripts/ci/sentry-cron-checkin.mjs");

  function run(args) {
    const dir = mkdtempSync(path.join(tmpdir(), "sentry-cron-checkin-"));
    const output = path.join(dir, "github-output");
    writeFileSync(output, "");
    const env = { ...process.env, GITHUB_OUTPUT: output };
    delete env.SENTRY_DSN;
    const result = spawnSync(process.execPath, [script, ...args], { env, encoding: "utf8" });
    return { ...result, output: readFileSync(output, "utf8") };
  }

  it("hands the check-in id to the finish step through GITHUB_OUTPUT, and exits 0 without a DSN", () => {
    const result = run(["--monitor", "production-db-backup", "--status", "in_progress"]);
    assert.equal(result.status, 0);
    assert.match(result.output, /^check_in_id=[0-9a-f-]{36}\n$/);
    assert.match(result.stderr, /::warning::.*SENTRY_DSN is not set/);
  });

  it("keeps a given check-in id", () => {
    const result = run(["--monitor", "production-db-backup", "--status", "ok", "--check-in-id", CHECK_IN_ID]);
    assert.equal(result.status, 0);
    assert.equal(result.output, `check_in_id=${CHECK_IN_ID}\n`);
  });

  it("opens a fresh check-in when the start step left the id empty", () => {
    const result = run(["--monitor", "production-db-backup", "--status", "error", "--check-in-id", ""]);
    assert.equal(result.status, 0);
    assert.match(result.output, /^check_in_id=[0-9a-f-]{36}\n$/);
  });

  it("exits 0 even on arguments it does not understand", () => {
    const result = run(["--bogus"]);
    assert.equal(result.status, 0);
    assert.match(result.stderr, /::warning::Sentry cron check-in crashed/);
  });
});

describe("MONITORS match the workflows they watch", () => {
  // A monitor on the wrong schedule pages every night for a job that ran fine.
  // max_runtime must not be shorter than the job's timeout-minutes, or Sentry
  // marks a run that is still going as timed out and pages for it. (It never
  // stops the job: the job's own timeout does, and the finish step then reports
  // `error`. max_runtime only decides a run whose closing check-in never lands.)
  // Both values are restated in MONITORS, so pin them to the workflow.
  function jobBlock(yaml, job) {
    return yaml.split(new RegExp(`^  ${job}:\\n`, "m"))[1]?.split(/^  [a-z][\w-]*:\n/m)[0];
  }

  /** The job's steps, each as its own block of text, in order. */
  function stepsOf(block) {
    return block.split(/^      - /m).slice(1);
  }

  for (const [slug, monitor] of Object.entries(MONITORS)) {
    const yaml = readFileSync(path.join(repoRoot, monitor.workflow), "utf8");
    const block = jobBlock(yaml, monitor.job);

    it(`${slug}: the workflow's schedule is the monitor's`, () => {
      const crons = [...yaml.matchAll(/cron:\s*"([^"]+)"/g)].map((match) => match[1]);
      assert.deepEqual(crons, [monitor.schedule]);
    });

    it(`${slug}: max_runtime equals the job's timeout-minutes`, () => {
      assert.ok(block, `job ${monitor.job} not found in ${monitor.workflow}`);
      assert.equal(Number(block.match(/timeout-minutes:\s*(\d+)/)?.[1]), monitor.maxRuntimeMinutes);
    });

    it(`${slug}: in_progress before the job's work, the outcome after it under if: always()`, () => {
      const steps = stepsOf(block);
      const checkIns = steps
        .map((step, index) => ({ step, index }))
        .filter(({ step }) => step.includes(`sentry-cron-checkin.mjs --monitor ${slug}`));
      assert.equal(checkIns.length, 2, "exactly one opening and one closing check-in");
      const [start, finish] = checkIns;

      // Every step between them is the job's work, and there is some.
      assert.ok(finish.index - start.index > 1, "the job's work runs between the two check-ins");
      assert.equal(start.index, steps.findIndex((step) => step.includes("--status in_progress")));
      assert.match(start.step, /id: cron-start\n/);
      assert.doesNotMatch(start.step, /\n\s+if:/, "the opening check-in runs whenever the job does");

      assert.match(finish.step, /\n\s+if: always\(\)\n/);
      assert.match(finish.step, /--status "\$\{\{ job\.status == 'success' && 'ok' \|\| 'error' \}\}"/);
      assert.match(finish.step, /--check-in-id "\$\{\{ steps\.cron-start\.outputs\.check_in_id \}\}"/);

      // A check-in must never fail or skip the backup, even if the script
      // cannot start at all.
      for (const { step } of checkIns) assert.match(step, /\n\s+continue-on-error: true\n/);
    });
  }
});
