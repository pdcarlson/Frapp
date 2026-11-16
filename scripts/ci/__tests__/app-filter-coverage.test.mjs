import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { CI, REPO, changesStep, filterList, relativeReads, sourceFiles } from "./helpers/source-reads.mjs";

// `mobile-validate`, `mobile-tests-tokyo`, `api-tests`, `web-tests`,
// `web-responsive-floor` and `landing-fold` are required checks that a PR or
// merge queue entry skips when every file it changes is in an area the job never reads
// (ci.yml, `changes`, the `apps` step). A skipped required job reports Success,
// so a spec that reads a file from one of those areas would let a PR that
// breaks it merge green, and the break would first show on `main`.
//
// Those reads are listed in the `filter` step's `mobile_reads`, `api_reads` and
// `web_reads` (landing reads nothing from the areas it skips, so it has none),
// and this test finds them (helpers/source-reads.mjs): every quoted path in an
// app's sources that starts with `../` (or `${__dirname}/../`) is resolved from
// its file, and one that lands in an area the app's filter skips must be listed.
// A spec that reads through a helper joining a directory onto an argument
// (`apiSource("…")`) is named in VIA_HELPER, which
// says which helper's literal arguments to read. Reads built any other way (a
// `join(root, "spec", …)` from separate segments) are invisible here, which is
// why the filter skips only whole areas, and runs the job on anything new.

const APPS = {
  mobile: {
    dir: "apps/mobile",
    reads: "mobile_reads",
    jobs: ["mobile-validate", "mobile-tests-tokyo"],
  },
  api: { dir: "apps/api", reads: "api_reads", jobs: ["api-tests"] },
  web: {
    dir: "apps/web",
    reads: "web_reads",
    jobs: ["web-tests", "web-responsive-floor"],
  },
  // A landing source that reads a skipped area needs a `landing_reads` list.
  landing: { dir: "apps/landing", reads: null, jobs: ["landing-fold"] },
};

// A file that reads another area through a helper: the helper's name and the
// directory it joins each argument onto.
const VIA_HELPER = {
  "apps/mobile/lib/events/check-in-outcome.spec.ts": {
    helper: "apiSource",
    base: "apps/api/src",
  },
};

/** Every repo path a file names by a quoted `../` literal or through its helper. */
function readsOf(file) {
  const text = readFileSync(join(REPO, file), "utf8");
  const paths = relativeReads(file, text);
  const via = VIA_HELPER[file];
  if (via) {
    for (const m of text.matchAll(
      new RegExp(`\\b${via.helper}\\(\\s*["'\`]([^"'\`]+)["'\`]`, "g"),
    )) {
      paths.push(`${via.base}/${m[1]}`);
    }
  }
  return paths;
}

describe("the app path filters list every file their specs read from a skipped area", () => {
  for (const [name, app] of Object.entries(APPS)) {
    it(`${name}: skips only whole areas, and lists what it reads from them`, () => {
      const patterns = filterList(changesStep("apps"), name);
      assert.equal(patterns[0], "**", `${name} must start from every file`);
      const skipped = patterns.slice(1).map((p) => {
        const m = p.match(/^!([\w.-]+(?:\/[\w.-]+)*)\/\*\*$/);
        assert.ok(
          m,
          `${name}: skip whole directories only ('!dir/**'), not ${p}`,
        );
        return `${m[1]}/`;
      });
      assert.ok(
        !skipped.some((s) => app.dir.startsWith(s)),
        `${name} must not skip its own app`,
      );
      const listed = new Set(app.reads ? filterList(changesStep("filter"), app.reads) : []);

      const missing = [];
      for (const file of sourceFiles(app.dir)) {
        for (const path of readsOf(file)) {
          if (path.startsWith("..") || !skipped.some((s) => path.startsWith(s)))
            continue;
          const abs = join(REPO, path);
          if (existsSync(abs) && statSync(abs).isDirectory()) {
            if (!VIA_HELPER[file])
              missing.push(
                `${file} reads the directory ${path}: name its helper in VIA_HELPER`,
              );
            continue;
          }
          if (!listed.has(path)) missing.push(`${file} reads ${path}`);
        }
      }
      assert.deepEqual(
        missing,
        [],
        `add these to ${app.reads ?? `a new ${name}_reads list`} in ci.yml's changes job`,
      );
      for (const path of listed)
        assert.ok(
          existsSync(join(REPO, path)),
          `${app.reads} lists ${path}, which is gone`,
        );
    });
  }

  it("gates each job on its filter, and still runs it on push", () => {
    const text = readFileSync(CI, "utf8");
    for (const [name, app] of Object.entries(APPS)) {
      // Exact form. The last arms run the job when a filter step failed in
      // the merge queue (its `continue-on-error`), whose outputs are empty.
      const arms = [
        `steps.apps.outputs.${name} == 'true'`,
        ...(app.reads ? [`steps.filter.outputs.${app.reads} == 'true'`] : []),
        "github.event.pull_request.changed_files > 3000",
        "steps.apps.outcome == 'failure'",
        ...(app.reads ? ["steps.filter.outcome == 'failure'"] : []),
      ];
      assert.ok(
        text.includes(`\n      ${name}: \${{ ${arms.join(" || ")} }}\n`),
        `ci.yml's changes output ${name} must be: ${arms.join(" || ")}`,
      );
      for (const job of app.jobs) {
        const block = text.slice(text.indexOf(`\n  ${job}:\n`));
        assert.ok(block.length < text.length, `ci.yml has no ${job} job`);
        const head = block.slice(0, block.indexOf("steps:"));
        assert.match(
          head,
          /needs: \[packages-build, changes\]/,
          `${job} needs changes`,
        );
        assert.ok(
          head.includes(
            // Behind the skip gate every CI job carries (#5084, #5141).
            `if: \${{ needs.changes.outputs.skip_suite != 'true' && (github.event_name == 'push' || needs.changes.outputs.${name} == 'true') }}`,
          ),
          `${job} runs on push, and on a PR or queue entry its filter matches`,
        );
      }
    }
    // Every pattern must hold for a file to count, which only `every` gives.
    assert.match(changesStep("apps"), /^\s+predicate-quantifier: every$/m);
  });
});
