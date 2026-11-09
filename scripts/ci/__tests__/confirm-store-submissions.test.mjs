import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  GRAPHQL_URL,
  MAX_FAILED_READS,
  confirmStoreSubmissions,
  nextStep,
  pollSubmissions,
  readSubmission,
  summary,
} from "../confirm-store-submissions.mjs";

const IOS = "3f1c2b4a-1111-4a2b-9c3d-0123456789ab";
const ANDROID = "9e8d7c6b-2222-4b3c-8d4e-abcdefabcdef";
const BUILD = "0b1c2d3e-3333-4c4d-8e5f-0123456789ab";

/** A fetch stand-in that answers each submission id from its own script of replies, in order. */
function fakeEas(replies) {
  const calls = [];
  const left = Object.fromEntries(Object.entries(replies).map(([id, list]) => [id, [...list]]));
  const fetchImpl = async (url, init) => {
    const { variables } = JSON.parse(init.body);
    calls.push({ url, id: variables.id, auth: init.headers.authorization });
    const list = left[variables.id];
    const next = list.length > 1 ? list.shift() : list[0];
    if (next instanceof Error) throw next;
    if (typeof next === "number") return { ok: false, status: next, json: async () => ({}) };
    if (next.errors) return { ok: true, status: 200, json: async () => ({ errors: next.errors }) };
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { submissions: { byId: { id: variables.id, status: next.status, error: next.error ?? null } } } }),
    };
  };
  return { fetchImpl, calls };
}

/** A clock that only moves when the poll sleeps. */
function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms) => void (t += ms), elapsed: () => t };
}

describe("readSubmission", () => {
  it("asks EAS's GraphQL API for the one submission, with the token as a bearer", async () => {
    const eas = fakeEas({ [IOS]: [{ status: "IN_QUEUE" }] });
    assert.deepEqual(await readSubmission({ id: IOS, token: "t0k", fetchImpl: eas.fetchImpl, sleep: async () => {} }), { status: "IN_QUEUE", error: null });
    assert.deepEqual(eas.calls, [{ url: GRAPHQL_URL, id: IOS, auth: "Bearer t0k" }]);
  });

  it("turns a network failure, an HTTP error or a GraphQL error into a read error", async () => {
    for (const reply of [new Error("socket hang up"), 502, 401, { errors: [{ message: "Unauthorized" }] }]) {
      const eas = fakeEas({ [IOS]: [reply] });
      const read = await readSubmission({ id: IOS, token: "t", fetchImpl: eas.fetchImpl, sleep: async () => {} });
      assert.ok(read.readError, JSON.stringify(read));
      assert.equal(read.status, undefined);
    }
  });

  it("asks again within the read after a dropped connection or a 5xx, but not after a 4xx", async () => {
    const blip = fakeEas({ [IOS]: [503, { status: "IN_PROGRESS" }] });
    assert.deepEqual(await readSubmission({ id: IOS, token: "t", fetchImpl: blip.fetchImpl, sleep: async () => {} }), { status: "IN_PROGRESS", error: null });
    assert.equal(blip.calls.length, 2);
    const refused = fakeEas({ [IOS]: [403] });
    await readSubmission({ id: IOS, token: "t", fetchImpl: refused.fetchImpl, sleep: async () => {} });
    assert.equal(refused.calls.length, 1);
  });

  it("keeps an error message from EAS on one line", async () => {
    const eas = fakeEas({ [IOS]: [{ errors: [{ message: "bad\n::error::forged" }] }] });
    const read = await readSubmission({ id: IOS, token: "t", fetchImpl: eas.fetchImpl, sleep: async () => {} });
    assert.equal(read.readError, "bad ::error::forged");
  });
});

describe("pollSubmissions", () => {
  it("waits out Expo's free queue until each submission ends", async () => {
    // Today's case: about 47 minutes in the queue, then the upload.
    const queued = Array.from({ length: 47 }, () => ({ status: "IN_QUEUE" }));
    const eas = fakeEas({
      [IOS]: [...queued, { status: "IN_PROGRESS" }, { status: "FINISHED" }],
      [ANDROID]: [...queued, { status: "FINISHED" }],
    });
    const c = clock();
    const rows = await pollSubmissions({
      submissions: [{ store: "ios", id: IOS }, { store: "android", id: ANDROID }],
      token: "t",
      fetchImpl: eas.fetchImpl,
      deadlineMs: 280 * 60_000,
      pollMs: 60_000,
      now: c.now,
      sleep: c.sleep,
      log: () => {},
    });
    assert.deepEqual(rows.map((r) => r.status), ["FINISHED", "FINISHED"]);
    assert.equal(c.elapsed(), 48 * 60_000);
  });

  it("stops at its deadline with the last status it read", async () => {
    const eas = fakeEas({ [IOS]: [{ status: "IN_QUEUE" }] });
    const c = clock();
    const rows = await pollSubmissions({
      submissions: [{ store: "ios", id: IOS }],
      token: "t",
      fetchImpl: eas.fetchImpl,
      deadlineMs: 10 * 60_000,
      pollMs: 60_000,
      now: c.now,
      sleep: c.sleep,
      log: () => {},
    });
    assert.equal(rows[0].status, "IN_QUEUE");
    assert.ok(c.elapsed() <= 10 * 60_000);
  });

  it("stops asking about a submission it couldn't read for MAX_FAILED_READS rounds in a row", async () => {
    const eas = fakeEas({ [IOS]: [{ errors: [{ message: "Submission not found" }] }] });
    const c = clock();
    const rows = await pollSubmissions({
      submissions: [{ store: "ios", id: IOS }],
      token: "t",
      fetchImpl: eas.fetchImpl,
      deadlineMs: 280 * 60_000,
      pollMs: 60_000,
      now: c.now,
      sleep: c.sleep,
      log: () => {},
    });
    assert.equal(eas.calls.length, MAX_FAILED_READS);
    assert.equal(rows[0].failedReads, MAX_FAILED_READS);
    assert.match(nextStep(rows[0]), /^iOS's submission couldn't be read \(Submission not found\), so this job doesn't know how it ended\./);
  });

  it("counts only failed reads in a row that asking again won't fix, so an API blip never ends the wait", async () => {
    const lasting = { errors: [{ message: "Unauthorized" }] };
    const blips = Array.from({ length: 12 }, () => 503);
    const replies = [...Array(MAX_FAILED_READS - 1).fill(lasting), { status: "IN_QUEUE" }, ...Array(MAX_FAILED_READS - 1).fill(lasting), ...blips, { status: "FINISHED" }];
    const eas = fakeEas({ [IOS]: replies });
    const c = clock();
    const rows = await pollSubmissions({
      submissions: [{ store: "ios", id: IOS }],
      token: "t",
      fetchImpl: eas.fetchImpl,
      deadlineMs: 280 * 60_000,
      pollMs: 60_000,
      now: c.now,
      sleep: c.sleep,
      log: () => {},
    });
    assert.equal(rows[0].status, "FINISHED");
    assert.equal(rows[0].failedReads, 0);
  });

  it("says a status is stale when the reads after it failed", () => {
    assert.match(
      nextStep({ store: "ios", id: IOS, status: "IN_QUEUE", readError: "HTTP 401", failedReads: 3 }),
      /still `IN_QUEUE` when this job stopped waiting \(its last read failed: HTTP 401\)\./,
    );
  });

  it("keeps reading after a failed read, and doesn't read an ended submission again", async () => {
    const eas = fakeEas({ [IOS]: [503, { status: "FINISHED" }], [ANDROID]: [{ status: "ERRORED", error: { errorCode: "X", message: "bad key" } }] });
    const c = clock();
    const rows = await pollSubmissions({
      submissions: [{ store: "ios", id: IOS }, { store: "android", id: ANDROID }],
      token: "t",
      fetchImpl: eas.fetchImpl,
      deadlineMs: 60 * 60_000,
      pollMs: 60_000,
      now: c.now,
      sleep: c.sleep,
      log: () => {},
    });
    assert.deepEqual(rows.map((r) => r.status), ["FINISHED", "ERRORED"]);
    assert.equal(rows[0].readError, null);
    assert.equal(eas.calls.filter((call) => call.id === ANDROID).length, 1);
  });
});

describe("nextStep and summary", () => {
  it("says nothing for a finished upload, and what to do with the record PR otherwise", () => {
    assert.equal(nextStep({ store: "ios", id: IOS, status: "FINISHED" }), null);
    const errored = nextStep({ store: "android", id: ANDROID, build: BUILD, status: "ERRORED", error: { errorCode: "SUBMISSION_SERVICE_ANDROID_UNKNOWN", message: "Google rejected the key" } });
    assert.match(errored, /^Android's upload to the Play internal track failed: Google rejected the key \(`SUBMISSION_SERVICE_ANDROID_UNKNOWN`\)\. The record PR lists this build, so drop its entry from the record PR before merging, or, once that has merged, move it to the registry's `dropped` list with this run as the reason, in a PR of its own/);
    assert.ok(errored.includes(`\`npm run eas -- submit --platform android --profile production --id ${BUILD} --non-interactive\` from the repo root`), errored);
    assert.match(errored, /while its commit is still the latest `v\*` tag/);
    const ios = nextStep({ store: "ios", id: IOS, build: BUILD, status: "CANCELED", error: null });
    assert.ok(ios.includes(`--id ${BUILD} --non-interactive --no-auto-testflight-setup\``), ios);
    assert.match(nextStep({ store: "ios", id: IOS, build: "", status: "ERRORED", error: null }), /upload it again by hand/);
    assert.match(nextStep({ store: "ios", id: IOS, status: "CANCELED" }), /^iOS's upload to TestFlight was cancelled\./);
    const queued = nextStep({ store: "ios", id: IOS, status: "IN_QUEUE", readError: null });
    assert.match(queued, /still `IN_QUEUE` when this job stopped waiting\. It may still finish: check https:\/\/expo\.dev\/accounts\/pdcarlson\/projects\/frapp\/submissions\//);
  });

  it("warns that a finished iOS upload can still be rejected in processing", () => {
    assert.match(summary([{ store: "ios", id: IOS, status: "FINISHED" }]), /App Store Connect can reject an iOS one by email after this/);
  });
});

describe("confirmStoreSubmissions", () => {
  const run = async (env, replies) => {
    const eas = fakeEas(replies);
    const c = clock();
    const logs = [];
    let written = "";
    const code = await confirmStoreSubmissions({
      env: { EXPO_TOKEN: "t", DEADLINE_MINUTES: "30", POLL_SECONDS: "60", ...env },
      fetchImpl: eas.fetchImpl,
      now: c.now,
      sleep: c.sleep,
      writeSummary: (text) => (written += text),
      log: (line) => logs.push(line),
    });
    return { code, written, logs, calls: eas.calls };
  };

  it("passes when every given submission finished, and checks only the ones it was given", async () => {
    const { code, written, calls } = await run({ IOS_UPLOAD: "success", IOS_SUBMISSION: IOS, ANDROID_UPLOAD: "skipped", ANDROID_SUBMISSION: "" }, { [IOS]: [{ status: "FINISHED" }] });
    assert.equal(code, 0);
    assert.match(written, new RegExp(`\\| iOS \\| \`${IOS}\` \\| \`FINISHED\` \\|`));
    assert.deepEqual([...new Set(calls.map((c) => c.id))], [IOS]);
  });

  it("fails on an errored upload or one still queued at the deadline", async () => {
    const errored = await run({ IOS_SUBMISSION: IOS }, { [IOS]: [{ status: "ERRORED", error: { message: "no" } }] });
    assert.equal(errored.code, 1);
    assert.ok(errored.logs.some((l) => /^::error::iOS's upload to TestFlight failed: no/.test(l)));
    const queued = await run({ ANDROID_SUBMISSION: ANDROID }, { [ANDROID]: [{ status: "IN_QUEUE" }] });
    assert.equal(queued.code, 1);
    assert.match(queued.written, /still `IN_QUEUE`/);
  });

  it("fails, and says where to look, when an upload succeeded but no submission id came back", async () => {
    const { code, written, calls } = await run(
      { IOS_UPLOAD: "success", IOS_SUBMISSION: IOS, ANDROID_UPLOAD: "success", ANDROID_SUBMISSION: "" },
      { [IOS]: [{ status: "FINISHED" }] },
    );
    assert.equal(code, 1);
    assert.deepEqual([...new Set(calls.map((c) => c.id))], [IOS]);
    assert.match(written, /\| Android \| none \| `no-id` \|/);
    assert.match(written, /EAS accepted Android's upload, but `eas submit` printed no submission link, so nothing checked it\./);
    const noToken = await run({ EXPO_TOKEN: "", IOS_UPLOAD: "success", IOS_SUBMISSION: IOS, ANDROID_UPLOAD: "success" }, {});
    assert.equal(noToken.code, 1);
    assert.equal(noToken.calls.length, 0);
    assert.match(noToken.written, /iOS's submission couldn't be read \(EXPO_TOKEN is empty\)/);
    assert.match(noToken.written, /EAS accepted Android's upload, but/);
    const alone = await run({ EXPO_TOKEN: "", IOS_UPLOAD: "success" }, {});
    assert.equal(alone.code, 1);
    assert.equal(alone.calls.length, 0);
    assert.match(alone.written, /EAS accepted iOS's upload, but/);
  });

  it("fails without reading anything when there's no token, no id, or an id that isn't one", async () => {
    for (const env of [{ EXPO_TOKEN: "", IOS_SUBMISSION: IOS }, {}, { IOS_SUBMISSION: "submissions/../x" }]) {
      const { code, calls, written } = await run(env, {});
      assert.equal(code, 1, JSON.stringify(env));
      assert.equal(calls.length, 0);
      assert.match(written, /^## Store uploads/);
    }
  });
});
