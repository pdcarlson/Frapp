// `record-shipped-builds.mjs`: the `record` job of `_mobile-build.yml` (#3111).
// Offline: every GitHub call goes through `makeFetchMock`.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseRegistry } from "../../check-api-breaking-changes.mjs";
import {
  REGISTRY_PATH,
  branchName,
  mergeRegistry,
  parseBuilds,
  planRecord,
  prTitle,
  recordShippedBuilds,
  summary,
} from "../record-shipped-builds.mjs";
import { makeFetchMock } from "./helpers.mjs";

const SHA = "979c914f0123456789abcdef0123456789abcdef";
const OTHER = "c29a449e72052d486e8c7de6d537b18503f585e4";
const DAY = "2026-10-01";

const iosBuild = (over = {}) => ({
  id: "ios-build-1",
  platform: "IOS",
  status: "FINISHED",
  appVersion: "0.9.0",
  appBuildVersion: "12",
  gitCommitHash: SHA,
  ...over,
});
const androidBuild = (over = {}) => ({
  id: "android-build-1",
  platform: "ANDROID",
  status: "FINISHED",
  appVersion: "0.9.0",
  appBuildVersion: "7",
  gitCommitHash: SHA,
  ...over,
});

const plan = (over = {}) =>
  planRecord({
    builds: [iosBuild(), androidBuild()],
    platform: "all",
    uploads: { ios: "success", android: "success" },
    sha: SHA,
    recorded: DAY,
    buildResult: "success",
    ...over,
  });

const b64 = (text) => Buffer.from(text, "utf8").toString("base64");
const EMPTY_REGISTRY = '{\n  "builds": []\n}\n';

describe("parseBuilds", () => {
  it("reads the build job's JSON array", () => {
    assert.deepEqual(parseBuilds(JSON.stringify([iosBuild()])), [iosBuild()]);
  });

  it("treats empty, malformed and non-array output as no list", () => {
    for (const raw of [undefined, "", "  ", "{", '{"id":"x"}', "[1]", "[null]", "[[]]"]) {
      assert.equal(parseBuilds(raw), null, String(raw));
    }
  });
});

describe("planRecord", () => {
  it("records every finished, uploaded build of the validated SHA", () => {
    const { entries, problems, rows } = plan();
    assert.deepEqual(problems, []);
    assert.deepEqual(entries, [
      { platform: "ios", version: "0.9.0", build: "12", sha: SHA, recorded: DAY },
      { platform: "android", version: "0.9.0", build: "7", sha: SHA, recorded: DAY },
    ]);
    assert.deepEqual(
      rows.map((r) => [r.store, r.recorded]),
      [
        ["ios", true],
        ["android", true],
      ],
    );
  });

  it("produces entries the shipped-contract checker accepts", () => {
    const { entries } = plan();
    assert.equal(parseRegistry(JSON.stringify({ builds: entries })).builds.length, 2);
  });

  it("looks only at the requested platform", () => {
    const { entries, rows } = plan({ platform: "ios", builds: [iosBuild()], uploads: { ios: "success" } });
    assert.deepEqual(entries.map((e) => e.platform), ["ios"]);
    assert.deepEqual(rows.map((r) => r.store), ["ios"]);
  });

  it("leaves out a build whose upload failed or never ran, without failing the record job", () => {
    for (const upload of ["failure", "skipped", "cancelled", "", undefined]) {
      const { entries, problems, rows } = plan({ uploads: { ios: "success", android: upload } });
      assert.deepEqual(entries.map((e) => e.platform), ["ios"], String(upload));
      assert.deepEqual(problems, [], String(upload));
      assert.equal(rows[1].upload, upload || "not run");
    }
  });

  it("leaves out a build that didn't finish, CANCELED included (eas build exits 0 for it)", () => {
    for (const status of ["CANCELED", "ERRORED", "IN_PROGRESS"]) {
      const { entries } = plan({ builds: [iosBuild({ status }), androidBuild()] });
      assert.deepEqual(entries.map((e) => e.platform), ["android"], status);
    }
  });

  it("refuses a build EAS made from any other commit, whatever its status", () => {
    const { entries, problems } = plan({ builds: [iosBuild({ gitCommitHash: OTHER }), androidBuild()] });
    assert.deepEqual(entries.map((e) => e.platform), ["android"]);
    assert.equal(problems.length, 1);
    assert.match(problems[0], new RegExp(`from ${OTHER}, not the validated ${SHA}`));
    const missing = plan({ builds: [iosBuild({ gitCommitHash: undefined })] , platform: "ios" });
    assert.match(missing.problems[0], /an unreported commit/);
  });

  it("refuses a version or build number shipped-builds.json can't hold", () => {
    for (const over of [{ appVersion: "0.9" }, { appBuildVersion: "0" }, { appBuildVersion: 12 }, { appVersion: undefined }]) {
      const { entries, problems } = plan({ platform: "ios", builds: [iosBuild(over)] });
      assert.deepEqual(entries, [], JSON.stringify(over));
      assert.equal(problems.length, 1, JSON.stringify(over));
    }
  });

  it("fails when a successful build job handed over no list, or no build for a requested platform", () => {
    assert.equal(plan({ builds: null }).problems.length, 1);
    const one = plan({ builds: [iosBuild()] });
    assert.deepEqual(one.problems, ["Android was requested, and the build job reported no Android build."]);
  });

  it("is quiet when the build job failed: its own red row carries that", () => {
    assert.deepEqual(plan({ builds: null, buildResult: "failure" }).problems, []);
    assert.deepEqual(plan({ builds: [iosBuild()], buildResult: "failure" }).problems, []);
  });

  it("refuses two builds of one platform, and an unknown platform input", () => {
    assert.equal(plan({ builds: [iosBuild(), iosBuild({ id: "ios-build-2" })], platform: "ios" }).problems.length, 1);
    assert.match(plan({ platform: "none" }).problems[0], /PLATFORM must be/);
    assert.match(plan({ platform: "" }).problems[0], /PLATFORM must be/);
  });
});

describe("mergeRegistry", () => {
  const entry = { platform: "ios", version: "0.9.0", build: "12", sha: SHA, recorded: DAY };

  it("appends new entries and keeps the file valid", () => {
    const { text, added } = mergeRegistry(EMPTY_REGISTRY, [entry]);
    assert.deepEqual(added, [entry]);
    assert.deepEqual(parseRegistry(text).builds, [entry]);
    assert.ok(text.endsWith("}\n"));
  });

  it("doesn't add an entry already listed (a re-run after the PR merged)", () => {
    const listed = JSON.stringify({ builds: [{ ...entry, recorded: "2026-09-30" }] });
    const { added, text } = mergeRegistry(listed, [entry]);
    assert.deepEqual(added, []);
    assert.equal(parseRegistry(text).builds.length, 1);
  });

  it("refuses a registry the checker would refuse", () => {
    assert.throws(() => mergeRegistry('{"builds": [{"commit": "x"}]}', [entry]), /unknown key/);
  });
});

describe("the PR", () => {
  it("names the builds it records, on a per-attempt branch", () => {
    assert.equal(
      prTitle([
        { platform: "ios", version: "0.9.0", build: "12" },
        { platform: "android", version: "0.9.0", build: "7" },
      ]),
      "chore(mobile): record iOS 0.9.0 (12) and Android 0.9.0 (7) in shipped-builds.json",
    );
    assert.equal(branchName({ runId: "123", runAttempt: "2" }), "shipped-builds/run-123-2");
  });
});

describe("recordShippedBuilds", () => {
  const env = (over = {}) => ({
    DEPLOY_SHA: SHA,
    EAS_BUILDS: JSON.stringify([iosBuild(), androidBuild()]),
    BUILD_RESULT: "success",
    PLATFORM: "all",
    IOS_UPLOAD: "success",
    ANDROID_UPLOAD: "success",
    GH_TOKEN: "app-token",
    GITHUB_REPOSITORY: "pdcarlson/Frapp",
    RUN_URL: "https://github.com/pdcarlson/Frapp/actions/runs/123",
    RUN_ID: "123",
    RUN_ATTEMPT: "1",
    ...over,
  });
  const routes = (registry = EMPTY_REGISTRY) => [
    { method: "GET", path: "/git/ref/heads/main", body: { object: { sha: "base-sha" } } },
    { method: "GET", path: `/contents/${REGISTRY_PATH}?ref=base-sha`, body: { content: b64(registry), sha: "blob-sha" } },
    { method: "POST", path: "/git/refs", status: 201, body: { ref: "refs/heads/shipped-builds/run-123-1" } },
    { method: "PUT", path: `/contents/${REGISTRY_PATH}`, body: { commit: { sha: "c1" } } },
    { method: "POST", path: "/pulls", status: 201, body: { html_url: "https://github.com/pdcarlson/Frapp/pull/9000", number: 9000 } },
  ];
  const run = async (over = {}, routeList = routes()) => {
    const { fetchImpl, calls } = makeFetchMock(routeList);
    let text = "";
    const logs = [];
    const code = await recordShippedBuilds({
      env: env(over),
      fetchImpl,
      now: new Date(`${DAY}T15:00:00Z`),
      writeSummary: (t) => {
        text += t;
      },
      log: (line) => logs.push(line),
    });
    return { code, calls, text, logs };
  };

  it("cuts a branch from main's tip, commits the merged file and opens the PR", async () => {
    const { code, calls, text } = await run();
    assert.equal(code, 0);
    assert.deepEqual(
      calls.map((c) => `${c.method} ${new URL(c.url).pathname}`),
      [
        "GET /repos/pdcarlson/Frapp/git/ref/heads/main",
        `GET /repos/pdcarlson/Frapp/contents/${REGISTRY_PATH}`,
        "POST /repos/pdcarlson/Frapp/git/refs",
        `PUT /repos/pdcarlson/Frapp/contents/${REGISTRY_PATH}`,
        "POST /repos/pdcarlson/Frapp/pulls",
      ],
    );
    const ref = JSON.parse(calls[2].body);
    assert.deepEqual(ref, { ref: "refs/heads/shipped-builds/run-123-1", sha: "base-sha" });
    const put = JSON.parse(calls[3].body);
    assert.equal(put.branch, "shipped-builds/run-123-1");
    assert.equal(put.sha, "blob-sha");
    const written = parseRegistry(Buffer.from(put.content, "base64").toString("utf8")).builds;
    assert.deepEqual(written.map((b) => `${b.platform}/${b.version}+${b.build}@${b.sha}`), [
      `ios/0.9.0+12@${SHA}`,
      `android/0.9.0+7@${SHA}`,
    ]);
    const pr = JSON.parse(calls[4].body);
    assert.equal(pr.base, "main");
    assert.equal(pr.head, "shipped-builds/run-123-1");
    assert.match(pr.body, /api-contract-check/);
    assert.doesNotMatch(pr.body, /\b(fixes|closes|resolves)\s+#/i);
    assert.match(text, /Recorded in https:\/\/github\.com\/pdcarlson\/Frapp\/pull\/9000/);
  });

  it("opens no PR when every build is already listed", async () => {
    const listed = JSON.stringify({
      builds: [
        { platform: "ios", version: "0.9.0", build: "12", sha: SHA, recorded: DAY },
        { platform: "android", version: "0.9.0", build: "7", sha: SHA, recorded: DAY },
      ],
    });
    const { code, calls, text } = await run({}, routes(listed));
    assert.equal(code, 0);
    assert.equal(calls.length, 2);
    assert.match(text, /already listed/);
  });

  it("calls no API and passes when nothing was uploaded", async () => {
    const { code, calls, text } = await run({ BUILD_RESULT: "failure", EAS_BUILDS: "", IOS_UPLOAD: "", ANDROID_UPLOAD: "" });
    assert.equal(code, 0);
    assert.equal(calls.length, 0);
    assert.match(text, /Nothing was uploaded/);
  });

  it("fails without a token, and lists the entries to add by hand", async () => {
    const { code, calls, text, logs } = await run({ GH_TOKEN: "" });
    assert.equal(code, 1);
    assert.equal(calls.length, 0);
    assert.match(text, /Not recorded/);
    assert.match(text, /"platform":"ios","version":"0.9.0","build":"12"/);
    assert.ok(logs.some((l) => l.startsWith("::error::No base-sync App token")));
  });

  it("fails, and lists the entries, when GitHub refuses a write", async () => {
    const refused = routes().map((r) => (r.path === "/pulls" ? { ...r, status: 403, body: { message: "Resource not accessible by integration" } } : r));
    const { code, text } = await run({}, refused);
    assert.equal(code, 1);
    assert.match(text, /POST \/repos\/pdcarlson\/Frapp\/pulls failed \(HTTP 403: Resource not accessible by integration\)/);
    assert.match(text, /Not recorded/);
  });

  it("records the upload that landed and says how to finish the one that didn't", async () => {
    const { code, calls, text } = await run({ ANDROID_UPLOAD: "failure" });
    assert.equal(code, 0);
    const put = JSON.parse(calls[3].body);
    const written = parseRegistry(Buffer.from(put.content, "base64").toString("utf8")).builds;
    assert.deepEqual(written.map((b) => b.platform), ["ios"]);
    assert.match(text, /eas submit --platform android --profile production --id android-build-1/);
  });

  it("refuses a malformed DEPLOY_SHA before anything else", async () => {
    const { code, calls } = await run({ DEPLOY_SHA: SHA.slice(0, 8) });
    assert.equal(code, 1);
    assert.equal(calls.length, 0);
  });
});

describe("summary", () => {
  it("says the ship is untouched, whatever happened here", () => {
    const text = summary({ sha: SHA, rows: [], entries: [], pr: null, problems: [] });
    assert.match(text, /Production and the version tag don't depend on anything here/);
  });
});
