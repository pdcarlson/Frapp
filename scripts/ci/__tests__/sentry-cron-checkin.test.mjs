import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MONITORS,
  checkInPayload,
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

describe("checkInPayload", () => {
  it("carries the monitor's schedule as an upsert, in UTC", () => {
    const payload = checkInPayload({
      monitor: MONITORS["production-db-backup"],
      status: "in_progress",
      checkInId: CHECK_IN_ID,
    });
    assert.deepEqual(payload, {
      check_in_id: CHECK_IN_ID,
      status: "in_progress",
      environment: "production",
      monitor_config: {
        schedule: { type: "crontab", value: "30 6 * * *" },
        timezone: "UTC",
        checkin_margin: 180,
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
    assert.equal(JSON.parse(calls[0].init.body).status, "ok");
    assert.equal(JSON.parse(calls[0].init.body).check_in_id, CHECK_IN_ID);
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

describe("MONITORS match the workflows they watch", () => {
  // A monitor on the wrong schedule pages every night for a job that ran fine,
  // and a max_runtime shorter than the job's timeout fails a backup that is
  // still running. Both copies are restated in MONITORS, so pin them.
  for (const [slug, monitor] of Object.entries(MONITORS)) {
    const yaml = readFileSync(path.join(repoRoot, monitor.workflow), "utf8");

    it(`${slug}: the workflow's schedule is the monitor's`, () => {
      const crons = [...yaml.matchAll(/cron:\s*"([^"]+)"/g)].map((match) => match[1]);
      assert.deepEqual(crons, [monitor.schedule]);
    });

    it(`${slug}: max_runtime equals the job's timeout-minutes`, () => {
      const jobBlock = yaml.split(new RegExp(`^  ${monitor.job}:\\n`, "m"))[1]?.split(/^  [a-z][\w-]*:\n/m)[0];
      assert.ok(jobBlock, `job ${monitor.job} not found in ${monitor.workflow}`);
      assert.equal(Number(jobBlock.match(/timeout-minutes:\s*(\d+)/)?.[1]), monitor.maxRuntimeMinutes);
    });

    it(`${slug}: the job opens and closes the check-in, the close under if: always()`, () => {
      const jobBlock = yaml.split(new RegExp(`^  ${monitor.job}:\\n`, "m"))[1]?.split(/^  [a-z][\w-]*:\n/m)[0];
      const invocations = [...jobBlock.matchAll(/sentry-cron-checkin\.mjs --monitor (\S+)/g)].map((m) => m[1]);
      assert.deepEqual(invocations, [slug, slug]);
      assert.match(jobBlock, /if: always\(\)\n\s+run: >-\n\s+node scripts\/ci\/sentry-cron-checkin\.mjs/);
      assert.match(jobBlock, /--check-in-id "\$\{\{ steps\.cron-start\.outputs\.check_in_id \}\}"/);
    });
  }
});
