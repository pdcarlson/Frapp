import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve, sep } from "node:path";

import { workflowSteps } from "./helpers/workflow-yaml.mjs";

// `mobile-validate`, `mobile-tests-tokyo` and `api-tests` are required checks
// that a PR skips when every file it changes is in an area the job never reads
// (ci.yml, `changes`, the `apps` step). A skipped required job reports Success,
// so a spec that reads a file from one of those areas would let a PR that
// breaks it merge green, and the break would first show on `main`.
//
// Those reads are listed in the `filter` step's `mobile_reads` and `api_reads`,
// and this test finds them: every quoted path in an app's sources that starts
// with `../` is resolved from its file, and one that lands in an area the app's
// filter skips must be listed. A spec that reads through a helper joining a
// directory onto an argument (`apiSource("…")`) is named in VIA_HELPER, which
// says which helper's literal arguments to read. Reads built any other way (a
// `join(root, "spec", …)` from separate segments) are invisible here, which is
// why the filter skips only whole areas, and runs the job on anything new.

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CI = join(REPO, ".github", "workflows", "ci.yml");

const APPS = {
  mobile: {
    dir: "apps/mobile",
    reads: "mobile_reads",
    jobs: ["mobile-validate", "mobile-tests-tokyo"],
  },
  api: { dir: "apps/api", reads: "api_reads", jobs: ["api-tests"] },
};

// A file that reads another area through a helper: the helper's name and the
// directory it joins each argument onto.
const VIA_HELPER = {
  "apps/mobile/lib/events/check-in-outcome.spec.ts": {
    helper: "apiSource",
    base: "apps/api/src",
  },
};

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".expo",
  ".next",
  "ios",
  "android",
  "coverage",
]);
const SOURCE = /\.(?:[cm]?[jt]sx?|json)$/;

function changesStep(id) {
  const step = workflowSteps(CI).find(
    (s) =>
      s.jobId === "changes" && new RegExp(`^\\s+id: ${id}$`, "m").test(s.body),
  );
  assert.ok(step, `ci.yml's changes job has no step with id ${id}`);
  return step.body;
}

/** The patterns under `name:` in a paths-filter step's `filters: |` block. */
function filterList(body, name) {
  const lines = body.split("\n");
  const at = lines.findIndex((l) => new RegExp(`^\\s+${name}:\\s*$`).test(l));
  assert.notEqual(at, -1, `no ${name} filter`);
  const indent = lines[at].match(/^\s*/)[0].length;
  const out = [];
  for (const line of lines.slice(at + 1)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (line.match(/^\s*/)[0].length <= indent) break;
    const m = line.match(/^\s*-\s*'([^']+)'\s*$/);
    assert.ok(m, `${name}: unreadable entry ${JSON.stringify(line)}`);
    out.push(m[1]);
  }
  return out;
}

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(join(REPO, dir), { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (SOURCE.test(entry.name)) out.push(path);
  }
  return out;
}

const toRepo = (abs) => relative(REPO, abs).split(sep).join("/");

/** Every repo path a file names by a quoted `../` literal or through its helper. */
function readsOf(file) {
  const text = readFileSync(join(REPO, file), "utf8");
  const from = dirname(join(REPO, file));
  const paths = [...text.matchAll(/["'`]((?:\.\.\/)+[^"'`\s$]*)["'`]/g)].map(
    (m) => toRepo(resolve(from, m[1])),
  );
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

describe("the mobile and API path filters list every file their specs read from a skipped area", () => {
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
      const listed = new Set(filterList(changesStep("filter"), app.reads));

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
        `add these to ${app.reads} in ci.yml's changes job`,
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
      assert.match(
        text,
        new RegExp(
          `^ {6}${name}: \\$\\{\\{ steps\\.apps\\.outputs\\.${name} == 'true' \\|\\| steps\\.filter\\.outputs\\.${app.reads} == 'true' \\|\\| github\\.event\\.pull_request\\.changed_files > 3000 \\}\\}$`,
          "m",
        ),
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
            `if: \${{ github.event_name != 'pull_request' || needs.changes.outputs.${name} == 'true' }}`,
          ),
          `${job} runs on push, in the merge queue, and on a PR its filter matches`,
        );
      }
    }
    // Every pattern must hold for a file to count, which only `every` gives.
    assert.match(changesStep("apps"), /^\s+predicate-quantifier: every$/m);
  });
});
