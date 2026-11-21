import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { CI, REPO, changesStep, filterList, relativeReads, sourceFiles } from "./helpers/source-reads.mjs";
import { workflowJobs } from "./helpers/workflow-yaml.mjs";
import { CI_CHECKS } from "../lib/required-checks.mjs";

// A PR or merge queue entry that changes only docs/ and spec/ skips the CI
// suite (#5141): ci.yml's `changes` sets `skip_suite`, and every job but a few
// skips on it. A skipped required job reports Success, so each way a docs-only
// change could still break a check has to be closed here:
//
//  - a job that reads docs keeps running on one (DOC_READERS), gated on
//    `queue_tested` alone;
//  - a doc any other job reads is in `docs_reads`, and changing it runs the
//    suite. The scan below finds those reads in apps/ and packages/ the way
//    app-filter-coverage.test.mjs does (helpers/source-reads.mjs): a quoted
//    `../` path, `${__dirname}/../` included, that resolves into docs/ or
//    spec/, or a quoted literal starting `docs/` or `spec/`. Reads built
//    any other way are invisible to it. scripts/ is not scanned: its checks
//    that read docs run in the three DOC_READERS jobs (ci-scripts-tests runs
//    every test under scripts/ci/__tests__, migration-safety reads the
//    migration ledgers through scripts/ci/lib/ops-docs.mjs, secret-scan reads
//    everything), and the scripts the skipping jobs run read none (checked
//    2026-11-16);
//  - a filter that fails, or a PR past GitHub's 3000-file listing, never skips.

/** Jobs that read docs, and so run on a docs-only change. */
const DOC_READERS = ["ci-scripts-tests", "secret-scan", "migration-safety"];
/** Jobs that never read the gate (queue-tested.test.mjs pins why). */
const NOT_GATED = ["changes", "packages-build", "main-caches"];

const jobs = workflowJobs(CI);
const byId = new Map(jobs.map((job) => [job.jobId, job]));

const IN_DOCS = /^(?:docs|spec)\//;

/** Every docs/ or spec/ path a source file names as a file to read. */
function docReadsOf(file, text) {
  const out = relativeReads(file, text).filter((path) => IN_DOCS.test(path));
  // Only plain quotes: a backticked `spec/…` is how comments cite a doc.
  for (const m of text.matchAll(/["']((?:docs|spec)\/[^"'\s$]*)["']/g)) out.push(m[1]);
  return out;
}

describe("docs-only changes skip the CI suite (#5141)", () => {
  it("skip_suite is queue_tested, or every file under docs/ or spec/ with none a skipped job reads", () => {
    const outputs = byId.get("changes").keys.get("outputs");
    assert.equal(
      outputs.get("skip_suite"),
      "${{ steps.queue.outputs.tested == 'true' || (steps.apps.outputs.outside_docs == 'false' && steps.filter.outputs.docs_reads == 'false' && !(github.event.pull_request.changed_files > 3000)) }}",
    );
    // The queue arm is the queue_tested output, word for word.
    assert.equal(outputs.get("queue_tested"), "${{ steps.queue.outputs.tested == 'true' }}");
  });

  it("outside_docs matches any file outside docs/ and spec/", () => {
    const apps = changesStep("apps");
    // Every pattern must hold for a file to count, which only `every` gives.
    assert.match(apps, /^\s+predicate-quantifier: every$/m);
    assert.deepEqual(filterList(apps, "outside_docs"), ["**", "!docs/**", "!spec/**"]);
  });

  it("docs_reads lists every doc that app and package sources read", () => {
    const listed = filterList(changesStep("filter"), "docs_reads");
    const read = new Map();
    for (const file of [...sourceFiles("apps"), ...sourceFiles("packages")]) {
      for (const path of docReadsOf(file, readFileSync(join(REPO, file), "utf8"))) {
        if (!read.has(path)) read.set(path, file);
      }
    }
    const missing = [...read].filter(([path]) => !listed.includes(path)).map(([path, file]) => `${file} reads ${path}`);
    assert.deepEqual(missing, [], "add these to docs_reads in ci.yml's changes job");
    for (const path of listed) {
      assert.match(path, IN_DOCS, `docs_reads lists ${path}, which outside_docs already counts as code`);
      assert.ok(existsSync(join(REPO, path)), `docs_reads lists ${path}, which is gone`);
    }
    // The scan has teeth: today's three readers are found.
    assert.ok(read.size >= 4, `expected the scan to find the known readers, saw ${read.size}`);
  });

  it("the scan finds both ways a source names a doc, and ignores a comment's citation", () => {
    const file = "apps/api/src/example.spec.ts";
    assert.deepEqual(docReadsOf(file, `join(__dirname, '../../../spec/behavior/observability.md')`), [
      "spec/behavior/observability.md",
    ]);
    assert.deepEqual(docReadsOf(file, "readFileSync(`${__dirname}/../../../spec/ui/design-system/writing.md`)"), [
      "spec/ui/design-system/writing.md",
    ]);
    assert.deepEqual(docReadsOf(file, `join(repoRoot, "docs/guides/testing.md")`), ["docs/guides/testing.md"]);
    assert.deepEqual(docReadsOf(file, "// per `spec/ui/assets.md` §7"), []);
  });

  it("the filters run on PRs and in the queue, and only the queue's can fail open to running the jobs", () => {
    for (const id of ["filter", "apps"]) {
      const body = changesStep(id);
      assert.match(body, /^\s*if:\s*github\.event_name != 'push'\s*$/m, `${id} runs on pull_request and merge_group`);
      // On a PR a failed filter must fail `changes`: its path outputs gate jobs
      // there, and an empty one would skip them. In the queue an empty output
      // can't read as 'false', so it runs the suite, and each path output
      // answers 'true' on the step's failed outcome (#5195;
      // merge-queue-triggers.test.mjs).
      assert.match(body, /^\s*continue-on-error:\s*\$\{\{ github\.event_name == 'merge_group' \}\}\s*$/m, id);
    }
  });

  it("the jobs that read docs still run on a docs-only change, and are required", () => {
    for (const id of DOC_READERS) {
      const job = byId.get(id);
      assert.ok(job, `${id} exists`);
      assert.equal(job.if, "${{ needs.changes.outputs.queue_tested != 'true' }}", id);
      assert.ok(CI_CHECKS.includes(id), `${id} is a required check`);
    }
  });

  for (const job of jobs.filter((j) => !NOT_GATED.includes(j.jobId) && !DOC_READERS.includes(j.jobId))) {
    it(`${job.jobId} skips on a docs-only change`, () => {
      assert.match(
        job.if ?? "",
        /^\$\{\{ needs\.changes\.outputs\.skip_suite != 'true'( && \(.+\))? \}\}$/,
        `${job.jobId}: gate on skip_suite, or add it to DOC_READERS if it reads docs`,
      );
    });
  }
});
