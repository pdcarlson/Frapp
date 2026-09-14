// A small, deliberate reader for GitHub workflow YAML, for tests that assert
// things about STEPS rather than about a file's text.
//
// ── Why not a YAML parser ──────────────────────────────────────────────────
// `yaml` and `js-yaml` both import successfully in this repo today, but neither
// is a declared dependency — `package.json` lists them only under `overrides`,
// so they resolve purely by transitive hoisting and npm is free to stop
// providing that. `deploy-api-check-changes.test.mjs` states the same policy
// and reads workflows as text for the same reason.
//
// ── Why not one more regex in each test ────────────────────────────────────
// Because that is the bug this module exists to stop. Workflow guards written
// as a grep over the whole file cannot fail: #2265 was a `DEPLOY_SHA`
// assertion that matched ANY occurrence, so the Vercel build step carried none
// for its entire life while the upload step's copy kept the test green. The
// same shape recurs wherever a test greps a region instead of a step.
//
// Three specific traps this reader is built not to fall into, each of which a
// hand-rolled regex in a test has fallen into here before:
//
//   * Comments count as matches. A rule satisfied by a line someone commented
//     out is not a rule. `significantLines` drops whole-line comments first.
//   * The last step of a job absorbs the next job. Splitting on `- name:`
//     leaves the final chunk running to the end of the file, so a value in a
//     LATER job silently satisfies an assertion about this one. Steps here are
//     bounded by their job.
//   * Steps without a `run: |` bind to a later step's script. The fence test's
//     `extractStepScript` searches forward for the first `run: |` with no upper
//     bound, so a step that has none returns the NEXT step's body and asserts
//     nothing about itself, with no assertion firing to say so.
//
// The shapes read here are the ones GitHub's workflow schema fixes: `env` is a
// flat map of scalars, and steps are a list of mappings under `steps:`. That
// makes an indentation reader sufficient; it is not a general YAML parser and
// should not be used as one.

import { readFileSync } from "node:fs";

/** Whole-line comments and blank lines dropped; indentation preserved. */
export function significantLines(text) {
  return text.split("\n").filter((line) => line.trim() !== "" && !/^\s*#/.test(line));
}

export function indentOf(line) {
  return line.match(/^\s*/)[0].length;
}

/**
 * The flat `KEY: value` map whose `env:` header is at `lines[headerIndex]`.
 *
 * Reads only keys at the mapping's own child indent, so a nested or multi-line
 * value cannot contribute phantom keys. Values come back trimmed with
 * surrounding quotes removed: `DEPLOY_PHASE: build` and `DEPLOY_PHASE: "build"`
 * are the same instruction to Actions and must be the same here.
 */
export function envMapAt(lines, headerIndex) {
  const headerIndent = indentOf(lines[headerIndex]);
  const map = new Map();
  let childIndent = null;

  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const indent = indentOf(lines[i]);
    if (indent <= headerIndent) break;
    if (childIndent === null) childIndent = indent;
    if (indent !== childIndent) continue;

    const match = lines[i].match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (match) map.set(match[1], match[2].trim().replace(/^["']|["']$/g, ""));
  }
  return map;
}

/** The index of an `env:` header at exactly `indent`, within `[from, to)`. */
function findEnvHeader(lines, from, to, indent) {
  for (let i = from; i < to; i += 1) {
    if (indentOf(lines[i]) === indent && /^\s*env:\s*$/.test(lines[i])) return i;
  }
  return -1;
}

/**
 * Every step in a workflow file, with the environment Actions would actually
 * give it.
 *
 * `env` resolves workflow → job → step, innermost winning, which is not a
 * nicety: `deploy-vercel-staging.yml` supplies three of its required variables
 * from a JOB-level block and `deploy-production.yml` declares the same three at
 * WORKFLOW level. A reader that saw only a step's own `env:` would report a bug
 * neither file has — and the usual fix for a guard that cries wolf is to delete
 * the guard.
 *
 * Returns `{ workflowFile, jobId, name, if: <raw expression|null>, env: Map,
 * body: <the step's raw text> }` per step.
 */
export function workflowSteps(workflowPath, workflowFile = workflowPath) {
  const lines = significantLines(readFileSync(workflowPath, "utf8"));

  const jobsIndex = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  const workflowEnvIndex = findEnvHeader(lines, 0, jobsIndex === -1 ? lines.length : jobsIndex, 0);
  const workflowEnv = workflowEnvIndex === -1 ? new Map() : envMapAt(lines, workflowEnvIndex);

  const steps = [];
  if (jobsIndex === -1) return steps;

  const jobStarts = [];
  for (let i = jobsIndex + 1; i < lines.length; i += 1) {
    if (indentOf(lines[i]) === 0) break;
    if (indentOf(lines[i]) === 2 && /^\s{2}[A-Za-z_][\w-]*:\s*$/.test(lines[i])) jobStarts.push(i);
  }

  for (let j = 0; j < jobStarts.length; j += 1) {
    const jobStart = jobStarts[j];
    const jobEnd = j + 1 < jobStarts.length ? jobStarts[j + 1] : lines.length;
    const jobId = lines[jobStart].trim().replace(/:$/, "");

    const jobEnvIndex = findEnvHeader(lines, jobStart + 1, jobEnd, 4);
    const jobEnv = jobEnvIndex === -1 ? new Map() : envMapAt(lines, jobEnvIndex);

    const stepStarts = [];
    for (let i = jobStart + 1; i < jobEnd; i += 1) {
      if (indentOf(lines[i]) === 6 && /^\s{6}- name:\s*/.test(lines[i])) stepStarts.push(i);
    }

    for (let s = 0; s < stepStarts.length; s += 1) {
      const stepStart = stepStarts[s];
      // Bounded by the JOB, not by the file: the last step of a job must not
      // absorb the next one.
      const stepEnd = s + 1 < stepStarts.length ? stepStarts[s + 1] : jobEnd;

      const stepEnvIndex = findEnvHeader(lines, stepStart + 1, stepEnd, 8);
      const stepEnv = stepEnvIndex === -1 ? new Map() : envMapAt(lines, stepEnvIndex);

      const ifLine = lines
        .slice(stepStart, stepEnd)
        .find((line) => indentOf(line) === 8 && /^\s*if:\s*/.test(line));

      steps.push({
        workflowFile,
        jobId,
        name: lines[stepStart].trim().replace(/^- name:\s*/, ""),
        if: ifLine ? ifLine.replace(/^\s*if:\s*/, "").trim() : null,
        env: new Map([...workflowEnv, ...jobEnv, ...stepEnv]),
        body: lines.slice(stepStart, stepEnd).join("\n"),
      });
    }
  }
  return steps;
}
