// `record-shipped-builds.mjs`: the `record` job of `_mobile-build.yml` (#3111),
// which records what the `ios` and `android` jobs built and uploaded (#5162).
// Offline: every GitHub call goes through `makeFetchMock`.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { REGISTRY_PATH, mergeRegistry, parseRegistry } from "../lib/shipped-builds-registry.mjs";
import {
  branchName,
  parseBuild,
  planRecord,
  prBody,
  prTitle,
  recordShippedBuilds,
  summary,
} from "../record-shipped-builds.mjs";
import { makeFetchMock } from "./helpers.mjs";

const SHA = "979c914f0123456789abcdef0123456789abcdef";
const OTHER = "c29a449e72052d486e8c7de6d537b18503f585e4";
const DAY = "2026-10-01";

// A build job's `build` output, as its build step writes it.
const iosBuild = (over = {}) => ({
  platform: "IOS",
  status: "FINISHED",
  appVersion: "0.9.0",
  appBuildVersion: "12",
  gitCommitHash: SHA,
  ...over,
});
const androidBuild = (over = {}) => ({
  platform: "ANDROID",
  status: "FINISHED",
  appVersion: "0.9.0",
  appBuildVersion: "7",
  gitCommitHash: SHA,
  ...over,
});

const job = (build, over = {}) => ({ result: "success", build, upload: "success", ...over });
const plan = ({ ios = {}, android = {}, ...over } = {}) =>
  planRecord({
    jobs: { ios: job(iosBuild(), ios), android: job(androidBuild(), android) },
    platform: "all",
    sha: SHA,
    recorded: DAY,
    ...over,
  });

const b64 = (text) => Buffer.from(text, "utf8").toString("base64");
const EMPTY_REGISTRY = '{\n  "builds": []\n}\n';

describe("mergeRegistry and dropped entries (#3783)", () => {
  const entry = { platform: "ios", version: "0.9.0", build: "12", sha: SHA, recorded: DAY };
  const dropped = { ...entry, dropped: "2026-12-01", reason: "minimum 0.9.1 live since 2026-11-30" };
  const withDropped = `${JSON.stringify({ builds: [], dropped: [dropped] }, null, 2)}\n`;

  it("doesn't re-add a build already moved to dropped (a re-run)", () => {
    const { text, added } = mergeRegistry(withDropped, [entry]);
    assert.deepEqual(added, []);
    assert.equal(text, withDropped);
  });

  it("keeps the dropped list when it appends", () => {
    const next = { ...entry, build: "13" };
    const { text } = mergeRegistry(withDropped, [next]);
    assert.deepEqual(parseRegistry(text), { builds: [next], dropped: [dropped] });
  });
});

describe("parseBuild", () => {
  it("reads a build job's JSON object", () => {
    assert.deepEqual(parseBuild(JSON.stringify(iosBuild())), iosBuild());
  });

  it("treats empty, malformed and non-object output as no build", () => {
    for (const raw of [undefined, "", "  ", "{", "[]", "[{}]", "1", "null", '"x"']) {
      assert.equal(parseBuild(raw), null, String(raw));
    }
  });
});

describe("planRecord", () => {
  it("records every built, uploaded build of the validated SHA", () => {
    const { entries, problems, rows } = plan();
    assert.deepEqual(problems, []);
    assert.deepEqual(entries, [
      { platform: "ios", version: "0.9.0", build: "12", sha: SHA, recorded: DAY },
      { platform: "android", version: "0.9.0", build: "7", sha: SHA, recorded: DAY },
    ]);
    assert.deepEqual(
      rows.map((r) => [r.store, r.planned]),
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
    const { entries, rows } = plan({ platform: "ios", android: { result: "skipped", build: null, upload: "" } });
    assert.deepEqual(entries.map((e) => e.platform), ["ios"]);
    assert.deepEqual(rows.map((r) => r.store), ["ios"]);
  });

  it("leaves out a build whose upload failed or never ran, without failing the record job", () => {
    for (const upload of ["failure", "skipped", "cancelled", "", undefined]) {
      const { entries, problems, rows } = plan({ android: { result: "failure", upload } });
      assert.deepEqual(entries.map((e) => e.platform), ["ios"], String(upload));
      assert.deepEqual(problems, [], String(upload));
      assert.equal(rows[1].upload, upload || "not run");
      assert.equal(rows[1].status, "FINISHED");
    }
  });

  it("names a job that handed over no build by its result, and fails only on a green one", () => {
    for (const [result, status] of [["failure", "failed"], ["cancelled", "cancelled"], ["skipped", "not built"], ["", "not built"]]) {
      const { entries, problems, rows } = plan({ ios: { result, build: null, upload: "" } });
      assert.deepEqual(entries.map((e) => e.platform), ["android"], result);
      assert.deepEqual(problems, [], result);
      assert.equal(rows[0].status, status, result);
    }
    const green = plan({ ios: { build: null, upload: "" } });
    assert.deepEqual(green.problems, [
      "The iOS job succeeded but handed over no build (its `build` output is empty or not a JSON object). Nothing can be recorded from it; read that job's log for the version it built.",
    ]);
  });

  it("refuses a build from any other commit, uploaded or not", () => {
    for (const upload of ["success", "skipped"]) {
      const { entries, problems, rows } = plan({ ios: { build: iosBuild({ gitCommitHash: OTHER }), upload } });
      assert.deepEqual(entries.map((e) => e.platform), ["android"], upload);
      assert.equal(rows[0].refused, true, upload);
      assert.equal(problems.length, 1, upload);
      assert.match(problems[0], new RegExp(`built from ${OTHER}, not the validated ${SHA}`), upload);
    }
    const missing = plan({ platform: "ios", ios: { build: iosBuild({ gitCommitHash: undefined }) } });
    assert.match(missing.problems[0], /an unreported commit/);
  });

  it("refuses a build handed over for the other platform", () => {
    const { entries, problems } = plan({ platform: "ios", ios: { build: androidBuild() } });
    assert.deepEqual(entries, []);
    assert.match(problems[0], /The iOS job handed over a build of 'ANDROID'/);
  });

  it("refuses a version or build number shipped-builds.json can't hold", () => {
    for (const over of [{ appVersion: "0.9" }, { appBuildVersion: "0" }, { appBuildVersion: 12 }, { appVersion: undefined }]) {
      const { entries, problems } = plan({ platform: "ios", ios: { build: iosBuild(over) } });
      assert.deepEqual(entries, [], JSON.stringify(over));
      assert.equal(problems.length, 1, JSON.stringify(over));
    }
  });

  it("refuses an unknown platform input", () => {
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

  // #3483: the upload step now submits with --no-wait, so its success means
  // EAS accepted the submission while Expo's free queue may hold it for most
  // of an hour. The build is recorded then, and the body points at the job
  // that says whether the upload finished.
  it("records a build whose submission is accepted but still queued, and says where to see it finish", () => {
    // Both platforms, as the queued 2026-11-05 run asked for: each accepted
    // submission is listed, with nothing in the body calling it uploaded.
    const { entries } = plan();
    assert.deepEqual(entries.map((e) => e.platform), ["ios", "android"]);
    const body = prBody({ entries, sha: SHA, runUrl: "https://x/runs/9", repo: "pdcarlson/Frapp" });
    assert.match(body, /built it on GitHub's runners, and submitted these builds to the stores without releasing them/);
    assert.match(body, /EAS accepted each submission, and Expo may still be uploading it\. \[The run\]\(https:\/\/x\/runs\/9\)'s `confirm` job says whether each upload finished\. If one failed, drop its entry before merging, or, once this has merged, move it to the registry's `dropped` list in a PR of its own\./);
    assert.match(body, /\| Submitted to \|/);
    assert.doesNotMatch(body, /[Uu]ploaded (build|to)/);
  });
});

describe("recordShippedBuilds", () => {
  const env = (over = {}) => ({
    DEPLOY_SHA: SHA,
    PLATFORM: "all",
    IOS_RESULT: "success",
    IOS_BUILD: JSON.stringify(iosBuild()),
    IOS_UPLOAD: "success",
    IOS_TAG_MOVED: "",
    IOS_TAG_BEFORE_BUILD: "success",
    IOS_TAG_BEFORE_UPLOAD: "success",
    ANDROID_RESULT: "success",
    ANDROID_BUILD: JSON.stringify(androidBuild()),
    ANDROID_UPLOAD: "success",
    ANDROID_TAG_MOVED: "",
    ANDROID_TAG_BEFORE_BUILD: "success",
    ANDROID_TAG_BEFORE_UPLOAD: "success",
    GH_TOKEN: "app-token",
    GITHUB_REPOSITORY: "pdcarlson/Frapp",
    RUN_URL: "https://github.com/pdcarlson/Frapp/actions/runs/123",
    RUN_ID: "123",
    RUN_ATTEMPT: "1",
    ...over,
  });
  // What a job that failed before its build step finished hands over.
  const unbuilt = (key, result = "failure") => ({ [`${key}_RESULT`]: result, [`${key}_BUILD`]: "", [`${key}_UPLOAD`]: "", [`${key}_TAG_BEFORE_UPLOAD`]: "" });
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
    assert.match(pr.body, /If `api-contract-check` fails here,\*\* `main` has already changed the API/);
    assert.doesNotMatch(pr.body, /nothing else needs review/);
    assert.doesNotMatch(pr.body, /\b(fixes|closes|resolves)\s+#/i);
    assert.match(text, /Recorded in https:\/\/github\.com\/pdcarlson\/Frapp\/pull\/9000/);
    assert.match(text, /\| iOS \| `FINISHED` \| 0\.9\.0 \(12\) \| `success` \| in the PR \|/);
  });

  // Paul, 2026-11-12: the record PR merges itself, but `merge-record` turns
  // that on only once `confirm` saw every upload finish, so this job only
  // hands over the PR.
  it("hands the opened PR's number on, and says when it merges itself", async () => {
    const outputs = [];
    const { fetchImpl, calls } = makeFetchMock(routes());
    let text = "";
    const code = await recordShippedBuilds({
      env: env({ AUTO_MERGE: "true" }),
      fetchImpl,
      now: new Date(`${DAY}T15:00:00Z`),
      writeSummary: (t) => {
        text += t;
      },
      writeOutput: (t) => outputs.push(t),
      log: () => {},
    });
    assert.equal(code, 0);
    assert.deepEqual(outputs, ["pr=9000\n"]);
    assert.ok(!calls.some((c) => c.url.includes("/graphql")), "this job never turns auto-merge on itself");
    const body = JSON.parse(calls[4].body).body;
    assert.match(body, /It merges itself once the run's `confirm` job sees every upload finish and its required checks pass/);
    assert.match(body, /If one failed, that job leaves auto-merge off and comments here: drop the failed build's entry and merge this by hand/);
    assert.match(text, /It merges itself once the `confirm` job sees every upload finish\./);
  });

  it("says to merge by hand without AUTO_MERGE", async () => {
    const { calls, text } = await run();
    assert.match(JSON.parse(calls[4].body).body, /Merge it before any tester installs/);
    assert.match(text, /Merge it before any tester installs these builds\./);
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
    assert.match(text, /already listed in/);
    assert.match(text, /\| `success` \| already listed \|/);
  });

  it("calls no API and passes when nothing was uploaded", async () => {
    const { code, calls, text } = await run({ ...unbuilt("IOS"), ...unbuilt("ANDROID") });
    assert.equal(code, 0);
    assert.equal(calls.length, 0);
    assert.match(text, /Nothing was uploaded/);
    assert.match(text, /\| iOS \| `failed` \| — \| `not run` \| no \|/);
  });

  it("fails without a token, and lists the entries to add by hand", async () => {
    const { code, calls, text, logs } = await run({ GH_TOKEN: "" });
    assert.equal(code, 1);
    assert.equal(calls.length, 0);
    assert.match(text, /Not recorded/);
    assert.match(text, /"platform":"ios","version":"0.9.0","build":"12"/);
    assert.ok(logs.some((l) => l.startsWith("::error::No base-sync App token")));
    // The table says so too: it is the first thing an operator reads.
    assert.match(text, /\| iOS \| `FINISHED` \| 0\.9\.0 \(12\) \| `success` \| \*\*no\*\*, see below \|/);
    assert.doesNotMatch(text, /\| (yes|in the PR|already listed) \|/);
  });

  it("fails, and lists the entries, when GitHub refuses a write", async () => {
    const refused = routes().map((r) => (r.path === "/pulls" ? { ...r, status: 403, body: { message: "Resource not accessible by integration" } } : r));
    const { code, text } = await run({}, refused);
    assert.equal(code, 1);
    assert.match(text, /POST \/repos\/pdcarlson\/Frapp\/pulls failed \(HTTP 403: Resource not accessible by integration\)/);
    assert.match(text, /Not recorded/);
    assert.match(text, /\| Android \| `FINISHED` \| 0\.9\.0 \(7\) \| `success` \| \*\*no\*\*, see below \|/);
  });

  it("records the upload that landed and sends the one that didn't to a re-run of its own job", async () => {
    const { code, calls, text } = await run({ ANDROID_RESULT: "failure", ANDROID_UPLOAD: "failure" });
    assert.equal(code, 0);
    const put = JSON.parse(calls[3].body);
    const written = parseRegistry(Buffer.from(put.content, "base64").toString("utf8")).builds;
    assert.deepEqual(written.map((b) => b.platform), ["ios"]);
    assert.match(
      text,
      /Android built but did not upload \(`failure`; the job's log says why\)\. Once the cause is fixed, use \*\*Re-run failed jobs\*\* on this run: it builds only Android, with a new build number/,
    );
    // A runner's binary isn't kept, so there is no build to upload by hand.
    assert.doesNotMatch(text, /eas -- submit/);
  });

  it("records one platform when the other failed to build, and sends that one to a re-run", async () => {
    const failed = await run(unbuilt("ANDROID"));
    assert.equal(failed.code, 0);
    const put = JSON.parse(failed.calls[3].body);
    assert.deepEqual(parseRegistry(Buffer.from(put.content, "base64").toString("utf8")).builds.map((b) => b.platform), ["ios"]);
    assert.match(failed.text, /Android didn't build \(`failed`\)\. Once the cause is fixed, use \*\*Re-run failed jobs\*\* on this run: it builds only Android/);
    assert.doesNotMatch(failed.text, /iOS (didn't|built but)/);
    const cancelled = await run(unbuilt("ANDROID", "cancelled"));
    assert.match(cancelled.text, /Android didn't build \(`cancelled`\)/);
  });

  it("is a wiring fault when a green job hands over no build", async () => {
    const { code, text } = await run({ ANDROID_BUILD: "" });
    assert.equal(code, 1);
    assert.match(text, /The Android job succeeded but handed over no build/);
  });

  it("forbids any upload once production has moved on, found before or after the build", async () => {
    const after = await run({
      IOS_RESULT: "failure",
      IOS_UPLOAD: "skipped",
      IOS_TAG_MOVED: "true",
      IOS_TAG_BEFORE_UPLOAD: "failure",
      ...unbuilt("ANDROID"),
      ANDROID_TAG_MOVED: "true",
      ANDROID_TAG_BEFORE_BUILD: "failure",
    });
    assert.equal(after.code, 0);
    assert.equal(after.calls.length, 0);
    assert.match(after.text, /iOS was not uploaded: production has shipped another commit since this run/);
    assert.match(after.text, /Android was not uploaded: production has shipped another commit/);
    assert.doesNotMatch(after.text, /eas -- submit|Re-run/, "a re-run would hit the same refusal");
  });

  it("reads each platform's tag checks apart", async () => {
    const { text } = await run({ IOS_RESULT: "failure", IOS_UPLOAD: "skipped", IOS_TAG_MOVED: "true", IOS_TAG_BEFORE_UPLOAD: "failure" });
    assert.match(text, /iOS was not uploaded: production has shipped another commit/);
    assert.doesNotMatch(text, /Android was not uploaded/);
  });

  it("tells a failed tag read from a moved production", async () => {
    const upload = await run({ IOS_RESULT: "failure", IOS_UPLOAD: "skipped", IOS_TAG_BEFORE_UPLOAD: "failure" });
    assert.match(upload.text, /iOS built, and was not uploaded because the latest-tag check before uploading failed without finding production moved/);
    assert.match(upload.text, /Once that's resolved, use \*\*Re-run failed jobs\*\*/);
    assert.doesNotMatch(upload.text, /was not uploaded: production has shipped another commit/);
    const build = await run({ ...unbuilt("IOS"), IOS_TAG_BEFORE_BUILD: "failure" });
    assert.match(build.text, /iOS didn't start: the latest-tag check before building failed without finding production moved/);
    assert.match(build.text, /use \*\*Re-run failed jobs\*\* on this run/);
  });

  it("never tells anyone to upload a build it refused", async () => {
    for (const IOS_UPLOAD of ["failure", "success"]) {
      const { code, text } = await run({
        PLATFORM: "ios",
        IOS_BUILD: JSON.stringify(iosBuild({ gitCommitHash: OTHER })),
        IOS_UPLOAD,
        ...unbuilt("ANDROID", "skipped"),
      });
      assert.equal(code, 1, IOS_UPLOAD);
      assert.match(text, /Don't let testers install it/);
      assert.doesNotMatch(text, /eas -- submit|Re-run/);
      // An upload that did happen is never reported as nothing uploaded.
      if (IOS_UPLOAD === "success") assert.doesNotMatch(text, /Nothing was uploaded/);
    }
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
    assert.match(text, /Production and the version tag don't depend on anything here: a failure leaves both as they are/);
  });
});
