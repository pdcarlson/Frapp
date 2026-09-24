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
import { basename } from "node:path";

/** Whole-line comments and blank lines dropped; indentation preserved. */
function significantLines(text) {
  return text.split("\n").filter((line) => line.trim() !== "" && !/^\s*#/.test(line));
}

function indentOf(line) {
  return line.match(/^\s*/)[0].length;
}

/**
 * One `env:` value, as Actions would see it.
 *
 * A trailing ` # …` is a YAML comment on an unquoted scalar, not part of the
 * value, and keeping it is a two-sided defect: `DEPLOY_PHASE: build # the
 * pre-apply half` would parse as the phase `"build # the pre-apply half"` and
 * make `parseDeployPhase` throw, while an inline comment on any `DEPLOY_SHA:`
 * line would fail the value assertion against a workflow that is correct. In a
 * file where roughly every other line is a comment, both are likely edits — and
 * a guard that cries wolf is one someone deletes.
 *
 * Only whitespace-preceded `#` counts, per YAML, so a `#` inside a value (a URL
 * fragment, an expression) survives. A quoted scalar is taken whole.
 */
function scalarValue(raw) {
  const trimmed = raw.trim();
  const quoted = trimmed.match(/^(["'])(.*)\1\s*(?:#.*)?$/);
  if (quoted) return quoted[2];
  return trimmed.replace(/\s+#.*$/, "").trim();
}

/**
 * A mapping key: bare, or quoted. `"issues": write` and `issues: write` are the
 * same key to YAML and so to Actions. A reader that skipped the quoted form
 * would let a guard on a whole block (`permissions:`) pass while the file
 * grants a scope the guard never saw. Use with `keyOf`.
 */
const KEY = String.raw`(?:"([^"]*)"|'([^']*)'|([A-Za-z_][\w-]*))`;

/** One fixed key, bare or quoted, as a regex fragment: `named("env")`. */
function named(key) {
  return `(?:${key}|"${key}"|'${key}')`;
}

/** The key from a match whose first three groups are KEY's alternatives. */
function keyOf(match) {
  return match[1] ?? match[2] ?? match[3];
}

/**
 * The flat `KEY: value` map whose `env:` header is at `lines[headerIndex]`.
 *
 * Reads only keys at the mapping's own child indent, so a nested or multi-line
 * value cannot contribute phantom keys. Values come back trimmed with
 * surrounding quotes removed: `DEPLOY_PHASE: build` and `DEPLOY_PHASE: "build"`
 * are the same instruction to Actions and must be the same here.
 */
function envMapAt(lines, headerIndex) {
  const headerIndent = indentOf(lines[headerIndex]);
  const map = new Map();
  let childIndent = null;

  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const indent = indentOf(lines[i]);
    if (indent <= headerIndent) break;
    if (childIndent === null) childIndent = indent;
    if (indent !== childIndent) continue;

    const match = lines[i].match(new RegExp(String.raw`^\s*${KEY}\s*:\s*(.*)$`));
    // A comment-only value is YAML null, not the comment's text.
    if (match) map.set(keyOf(match), opensMapping(match[4]) ? "" : scalarValue(match[4]));
  }
  return map;
}

/**
 * The index of an `env:` header at exactly `indent`, within `[from, to)`.
 *
 * The trailing `(\s*#.*)?` is not decoration: `significantLines` drops lines
 * that BEGIN with `#`, so an INLINE comment (`env: # prod only`) survives, and
 * without this the header is invisible, the block reads as absent, and every
 * variable in it silently stops being seen. That fails toward green.
 */
function findEnvHeader(lines, from, to, indent) {
  for (let i = from; i < to; i += 1) {
    if (indentOf(lines[i]) === indent && new RegExp(String.raw`^\s*${named("env")}\s*:(\s*#.*)?\s*$`).test(lines[i])) {
      return i;
    }
  }
  return -1;
}

/**
 * Is this line a `  <jobId>:` header?
 *
 * Quotes are permitted because `"deploy":` is valid YAML for the same job id,
 * and an inline comment is tolerated for the reason above. Both were
 * demonstrated by mutation rather than observed in the committed files, and
 * both fail silently: with a comment on `  deploy:`, that job becomes
 * invisible and its 22 steps are re-attributed to the job before it — so every
 * assertion message names the wrong job and job-level `env:` resolves against
 * the wrong block. `turbo-packages-build-action.test.mjs` documents the same
 * two tolerances for the same reasons.
 */
function isJobHeader(line) {
  return /^ {2}["']?[A-Za-z_][\w-]*["']?:(\s*#.*)?\s*$/.test(line);
}

/** The job id from a header line, with quotes and any inline comment removed. */
function jobIdFrom(line) {
  return line
    .replace(/\s*#.*$/, "")
    .trim()
    .replace(/:$/, "")
    .replace(/^["'](.*)["']$/, "$1");
}

/**
 * Is this the header of a block scalar (`|`, `>`, `|-`, `>2-`, `|-2`, …)?
 *
 * YAML lets the chomping and indentation indicators appear in EITHER order, so
 * a regex that only allows `-` before the digit reads `|2-` as an expression and
 * returns the literal `"|2-"` as the condition — fail-open for a `doesNotMatch`
 * assertion, which is precisely what `stepIf` exists to avoid.
 */
function isBlockScalarHeader(value) {
  return /^[|>](?:[-+]\d*|\d*[-+]?)$/.test(value);
}

/**
 * The line indices of a job's steps, found via its `steps:` key.
 *
 * Returns [] for a job with no `steps:` (a `uses:` reusable-workflow call),
 * which is correct: it has none.
 */
function stepIndices(lines, jobStart, jobEnd) {
  let stepsKey = -1;
  for (let i = jobStart + 1; i < jobEnd; i += 1) {
    if (indentOf(lines[i]) === 4 && new RegExp(String.raw`^\s*${named("steps")}\s*:\s*(#.*)?$`).test(lines[i])) {
      stepsKey = i;
      break;
    }
  }
  if (stepsKey === -1) return [];

  const first = lines.slice(stepsKey + 1, jobEnd).find((line) => /^\s*- \S/.test(line));
  if (!first) return [];
  const seqIndent = indentOf(first);

  const starts = [];
  for (let i = stepsKey + 1; i < jobEnd; i += 1) {
    const indent = indentOf(lines[i]);
    if (indent < seqIndent) break;
    if (indent === seqIndent && /^\s*- \S/.test(lines[i])) starts.push(i);
  }
  return starts;
}

/**
 * A step's `name:`, wherever it sits in the step.
 *
 * `- name: X` is the common form, but `name:` may follow `- uses:`/`- run:`,
 * and a step may have none — in which case it is identified by its first key so
 * a failure message still points somewhere real.
 */
function stepName(lines, stepStart, stepEnd) {
  const first = lines[stepStart].trim().replace(/^-\s*/, "");
  const nameKey = new RegExp(String.raw`^${named("name")}\s*:\s*`);
  if (nameKey.test(first)) return scalarValue(first.replace(nameKey, ""));
  for (let i = stepStart + 1; i < stepEnd; i += 1) {
    if (indentOf(lines[i]) === 8 && nameKey.test(lines[i].trim())) {
      return scalarValue(lines[i].trim().replace(nameKey, ""));
    }
  }
  return `<unnamed: ${first.split(":")[0]}>`;
}

/**
 * A step's `if:` expression, including the block-scalar forms.
 *
 * `if: >-` and `if: |` put the condition on the FOLLOWING lines, and this repo
 * already writes conditions that way (`deploy-vercel-staging.yml`). Returning
 * the indicator (`">-"`) instead of the expression is fail-open for a
 * `doesNotMatch` assertion: a step re-gated on `dry_run_only` in block form
 * would read as ungated and the guard would stay green.
 */
function stepIf(lines, stepStart, stepEnd) {
  for (let i = stepStart; i < stepEnd; i += 1) {
    const atStepKeyIndent =
      i === stepStart
        ? new RegExp(String.raw`^\s{6}- ${named("if")}\s*:\s*`).test(lines[i])
        : indentOf(lines[i]) === 8 && new RegExp(String.raw`^\s*${named("if")}\s*:\s*`).test(lines[i]);
    if (!atStepKeyIndent) continue;

    const inline = lines[i].replace(new RegExp(String.raw`^\s*-?\s*${named("if")}\s*:\s*`), "").trim();
    if (inline !== "" && !isBlockScalarHeader(inline)) return inline;

    // Block scalar: the condition is the deeper-indented lines beneath it.
    //
    // For the FIRST-key form (`- if: >-`) the dash sits at the step indent but
    // the step's sibling keys sit two deeper, so using the dash's own indent as
    // the base never breaks and folds `name:`, `env:` and `run:` into the
    // condition — which makes a correct REHEARSED step fail and lets a swallowed
    // line satisfy a SHIPPING match.
    const base = i === stepStart ? indentOf(lines[i]) + 2 : indentOf(lines[i]);
    const parts = [];
    for (let j = i + 1; j < stepEnd; j += 1) {
      if (indentOf(lines[j]) <= base) break;
      parts.push(lines[j].trim());
    }
    return parts.join(" ").trim() || null;
  }
  return null;
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
export function workflowSteps(workflowPath) {
  const workflowFile = basename(workflowPath);
  const lines = significantLines(readFileSync(workflowPath, "utf8"));

  const jobsIndex = lines.findIndex((line) => new RegExp(String.raw`^${named("jobs")}\s*:\s*(#.*)?$`).test(line));
  // Scanned across the WHOLE file, not just above `jobs:` — YAML mapping key
  // order is free, and a workflow-level `env:` written after `jobs:` was
  // invisible, emptying every step's merged env and failing correct workflows.
  // Only column 0 can be workflow level, so this cannot pick up a job's block.
  const workflowEnvIndex = findEnvHeader(lines, 0, lines.length, 0);
  const workflowEnv = workflowEnvIndex === -1 ? new Map() : envMapAt(lines, workflowEnvIndex);

  const steps = [];
  if (jobsIndex === -1) return steps;

  const jobStarts = [];
  for (let i = jobsIndex + 1; i < lines.length; i += 1) {
    if (indentOf(lines[i]) === 0) break;
    if (indentOf(lines[i]) === 2 && isJobHeader(lines[i])) jobStarts.push(i);
  }

  for (let j = 0; j < jobStarts.length; j += 1) {
    const jobStart = jobStarts[j];
    const jobEnd = j + 1 < jobStarts.length ? jobStarts[j + 1] : lines.length;
    const jobId = jobIdFrom(lines[jobStart]);

    const jobEnvIndex = findEnvHeader(lines, jobStart + 1, jobEnd, 4);
    const jobEnv = jobEnvIndex === -1 ? new Map() : envMapAt(lines, jobEnvIndex);

    // Anchored to the job's `steps:` key, and to whatever indent ITS sequence
    // uses. Two earlier shapes were both wrong, in opposite directions:
    //
    //   * Requiring `- name:` first made a step that leads with `- uses:` or
    //     `- run:`, or has no name at all, INVISIBLE — so every assertion that
    //     loops over steps passed for it. That is the #2265 failure again.
    //   * Accepting any `- ` at indent 6 invented phantom steps out of the block
    //     sequences `needs:` and `runs-on:` legally take at that same indent,
    //     which would let three fakes satisfy the `carriers().length >= 5` floor
    //     that exists to notice this reader breaking.
    //
    // Reading the sequence indent rather than hardcoding 6 also accepts the
    // `    steps:` / `    - name:` style, which is valid YAML and which the old
    // form parsed as zero steps — dropping a whole workflow out of the contract
    // check while the floor stayed green.
    const stepStarts = stepIndices(lines, jobStart, jobEnd);

    for (let s = 0; s < stepStarts.length; s += 1) {
      const stepStart = stepStarts[s];
      // Bounded by the JOB, not by the file: the last step of a job must not
      // absorb the next one.
      const stepEnd = s + 1 < stepStarts.length ? stepStarts[s + 1] : jobEnd;

      const stepEnvIndex = findEnvHeader(lines, stepStart + 1, stepEnd, 8);
      const stepEnv = stepEnvIndex === -1 ? new Map() : envMapAt(lines, stepEnvIndex);

      steps.push({
        workflowFile,
        jobId,
        name: stepName(lines, stepStart, stepEnd),
        if: stepIf(lines, stepStart, stepEnd),
        env: new Map([...workflowEnv, ...jobEnv, ...stepEnv]),
        // The step's OWN env, unmerged. Some values are only legal here: a
        // `steps.*` reference is not available in a job-level `env:`, so a
        // guard that accepted it from the merged map would bless a workflow
        // GitHub refuses to start.
        stepEnv,
        body: lines.slice(stepStart, stepEnd).join("\n"),
      });
    }
  }
  return steps;
}

/**
 * Does this raw value open a nested mapping? Empty, or only a comment
 * (`outputs: # the verdict`). `scalarValue` can't be asked: it strips a `#`
 * only after whitespace, and the key regex has already consumed that, so the
 * comment would come back as the value.
 */
function opensMapping(raw) {
  return /^\s*(#.*)?$/.test(raw);
}

/**
 * A flow collection's body split on its top-level commas: not a comma inside a
 * quoted scalar or a nested collection (`{ a: [x, y], b: "c, d" }` is two
 * entries). Like YAML, a quote opens a quoted scalar only where a scalar
 * starts (after `{`, `[`, `,` or `:`), so the apostrophe in `note: don't` is
 * plain text; `\"` inside double quotes and `''` inside single quotes are
 * escapes, not the end. A stray `]` or `}` in a plain value never drives the
 * depth below zero, so it can't stop the splitting for the rest of the body.
 * Parentheses aren't flow indicators and aren't tracked.
 */
function splitFlow(body) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  let scalarStart = true;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quote === '"') {
      if (ch === "\\") i += 1;
      else if (ch === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      if (ch === "'" && body[i + 1] === "'") i += 1;
      else if (ch === "'") quote = null;
      continue;
    }
    if ((ch === '"' || ch === "'") && scalarStart) {
      quote = ch;
    } else if (ch === "{" || ch === "[") {
      depth += 1;
    } else if (ch === "}" || ch === "]") {
      depth = Math.max(0, depth - 1);
    } else if (ch === "," && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
    if (ch === "{" || ch === "[" || ch === "," || ch === ":") scalarStart = true;
    else if (!/\s/.test(ch)) scalarStart = false;
  }
  parts.push(body.slice(start));
  return parts;
}

/** `{ contents: read, issues: write }` as a Map, or null for any other value. */
function flowMapping(value) {
  const body = /^\{(.*)\}$/.exec(value)?.[1];
  if (body === undefined) return null;
  const map = new Map();
  for (const pair of splitFlow(body)) {
    const match = pair.match(new RegExp(String.raw`^\s*${KEY}\s*:\s*(.*)$`));
    if (match) map.set(keyOf(match), scalarValue(match[4]));
  }
  return map;
}

/**
 * The keys at exactly `indent` within `[from, to)`, read the way `env:` is.
 *
 * An inline value comes back as a scalar (`needs: [a, b]` → `"[a, b]"`, quotes
 * and a trailing comment removed); a mapping, block (`outputs:`, with or
 * without an inline comment) or flow (`{ a: b }`), comes back as a flat Map of
 * its immediate children, so `outputs:`, `permissions:` and `environment:` can
 * be asserted key by key rather than by a regex over the text, which a quoted
 * value or a comment would break. A block sequence or a block scalar reads as
 * an empty Map or its indicator; this is not a YAML parser.
 */
function keysAt(lines, from, to, indent) {
  const keys = new Map();
  for (let i = from; i < to; i += 1) {
    if (indentOf(lines[i]) !== indent) continue;
    const match = lines[i].match(new RegExp(String.raw`^\s*${KEY}\s*:(.*)$`));
    if (!match) continue;
    if (opensMapping(match[4])) {
      keys.set(keyOf(match), envMapAt(lines, i));
    } else {
      const value = scalarValue(match[4]);
      keys.set(keyOf(match), flowMapping(value) ?? value);
    }
  }
  return keys;
}

/**
 * The workflow's top-level keys (`name`, `on`, `permissions`, …), as
 * `keysAt` reads them. `permissions` is the one worth asserting whole: a regex
 * anchored on its first scope passes when a write scope follows it.
 */
export function workflowKeys(workflowPath) {
  const lines = significantLines(readFileSync(workflowPath, "utf8"));
  return keysAt(lines, 0, lines.length, 0);
}

/**
 * Every job in a workflow, with its `if:` expression and its own keys.
 *
 * Steps are not the whole story: `release` — the job that mints and pushes the
 * `vX.Y.Z` tag — is gated at JOB level, so a guard that only walked steps could
 * not see the one thing standing between a dry run and a version tag naming a
 * commit that was never deployed.
 *
 * Returns `{ jobId, if: <raw expression|null>, keys: Map }` per job; `keys`
 * holds the job's own keys (indent 4), as described at `keysAt`.
 */
export function workflowJobs(workflowPath) {
  const lines = significantLines(readFileSync(workflowPath, "utf8"));
  const jobsIndex = lines.findIndex((line) => new RegExp(String.raw`^${named("jobs")}\s*:\s*(#.*)?$`).test(line));
  if (jobsIndex === -1) return [];

  const jobs = [];
  const starts = [];
  for (let i = jobsIndex + 1; i < lines.length; i += 1) {
    if (indentOf(lines[i]) === 0) break;
    if (indentOf(lines[i]) === 2 && isJobHeader(lines[i])) starts.push(i);
  }

  for (let j = 0; j < starts.length; j += 1) {
    const from = starts[j];
    const to = j + 1 < starts.length ? starts[j + 1] : lines.length;

    let condition = null;
    for (let i = from + 1; i < to; i += 1) {
      const ifKey = new RegExp(String.raw`^\s*${named("if")}\s*:\s*`);
      if (indentOf(lines[i]) !== 4 || !ifKey.test(lines[i])) continue;
      const inline = lines[i].replace(ifKey, "").trim();
      if (inline !== "" && !isBlockScalarHeader(inline)) {
        condition = inline;
      } else {
        const parts = [];
        for (let k = i + 1; k < to && indentOf(lines[k]) > 4; k += 1) parts.push(lines[k].trim());
        condition = parts.join(" ").trim() || null;
      }
      break;
    }
    jobs.push({ jobId: jobIdFrom(lines[from]), if: condition, keys: keysAt(lines, from + 1, to, 4) });
  }
  return jobs;
}
