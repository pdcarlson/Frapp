// What ci.yml's `changes` filters list, and what app and package sources read
// from disk, for the tests that pin one against the other:
// app-filter-coverage.test.mjs (`mobile_reads`, `api_reads`) and
// docs-only-skip.test.mjs (`docs_reads`).

import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { WORKFLOW_DIR, workflowSteps } from "./workflow-yaml.mjs";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
export const CI = join(WORKFLOW_DIR, "ci.yml");

const SKIP_DIRS = new Set(["node_modules", "dist", ".expo", ".next", ".turbo", "ios", "android", "coverage"]);
const SOURCE = /\.(?:[cm]?[jt]sx?|json)$/;

/** The body of the `changes` job step with this `id:`. */
export function changesStep(id) {
  const step = workflowSteps(CI).find((s) => s.jobId === "changes" && new RegExp(`^\\s+id: ${id}$`, "m").test(s.body));
  assert.ok(step, `ci.yml's changes job has no step with id ${id}`);
  return step.body;
}

/** The patterns under `name:` in a paths-filter step's `filters: |` block. */
export function filterList(body, name) {
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

/** Every source file under `dir` (repo-relative), build output skipped. */
export function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(join(REPO, dir), { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (SOURCE.test(entry.name)) out.push(path);
  }
  return out;
}

/**
 * Every repo path `file` names by a quoted `../` literal, resolved from its own
 * directory. A template literal may lead with one interpolation, as in
 * `${__dirname}/../spec/…`, which is how a spec built from `__dirname` or
 * `import.meta.dirname` reads beside itself.
 */
export function relativeReads(file, text) {
  const from = dirname(join(REPO, file));
  return [...text.matchAll(/["'`](?:\$\{[^}`]*\}\/)?((?:\.\.\/)+[^"'`\s$]*)["'`]/g)].map((m) =>
    relative(REPO, resolve(from, m[1])).split(sep).join("/"),
  );
}
