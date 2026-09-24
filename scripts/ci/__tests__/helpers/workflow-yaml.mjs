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
// should not be used as one. A non-empty flow mapping (`{ a: b }`) as a key's
// value, and a non-empty flow `env:`, throw instead of being guessed at (see
// `keysAt`), because a guard over a misread value passes; `{}` reads as empty.
// Known gap: anchors, tags and aliases in a value are returned as text (#2639).

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
 * A raw value with its comment removed, a quoted scalar kept whole, quotes and
 * all.
 *
 * YAML starts a comment at a `#` that opens the value or follows whitespace,
 * but never inside quotes. `if:` is often quoted (a leading `!` is a YAML tag),
 * and `if: "contains(msg, ' #skip') && inputs.dry_run_only"` is one condition:
 * cutting it at the ` #` drops the clause a `doesNotMatch` guard is looking
 * for. The quoted forms are matched to their real closing quote (`\"` escapes
 * one in double quotes, `''` in single), so a quote inside the trailing comment
 * can't extend the value either.
 */
function withoutComment(raw) {
  const trimmed = raw.trim();
  const quoted = trimmed.match(/^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*')(?:\s+#.*)?$/);
  if (quoted) return quoted[1];
  return trimmed.replace(/(^|\s+)#.*$/, "").trim();
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
 * Only a `#` that opens the value or follows whitespace counts, per YAML, so a
 * `#` inside a value (a URL fragment, an expression) survives. A quoted scalar
 * is taken whole, then unquoted (`withoutComment`).
 */
function scalarValue(raw) {
  const value = withoutComment(raw);
  const quoted = value.match(/^(["'])([\s\S]*)\1$/);
  return quoted ? quoted[2] : value;
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
function envMapAt(lines, headerIndex, floor = indentOf(lines[headerIndex])) {
  // `floor`: the indent at or above which the mapping has ended. The header's
  // own indent, except for a step's first key (`- env:`), whose siblings sit
  // deeper than its dash.
  const headerIndent = floor;
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
 * Does this raw value (the text after a key's colon, before quotes are
 * stripped) open a flow mapping? A node property may come first
 * (`&p { … }`, `!!map { … }`). A quoted `'{ … }'` is a string, so the test runs
 * on the raw text.
 */
function isFlowMapping(raw) {
  return /^\s*(?:[&!]\S*\s+)*\{/.test(raw);
}

/** `{}`: a flow mapping with nothing in it, which hides nothing to refuse. */
function isEmptyFlowMapping(raw) {
  return /^\s*(?:[&!]\S*\s+)*\{\s*\}\s*(#.*)?$/.test(raw);
}

/** The refusal `keysAt`, `findEnvHeader` and `stepEnvAt` share; see `keysAt`. */
function refuseFlowMapping(key, raw) {
  return new Error(
    `workflow-yaml: \`${key}:\` is a flow mapping (${raw.trim()}), which this reader ` +
      "refuses rather than guesses at. Write it in block form, one key per line.",
  );
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
  // A flow-form `env: { … }` would otherwise read as no env at all, and an
  // absence guard (no GITHUB_SHA override) would pass on the override itself.
  const flowEnv = new RegExp(String.raw`^\s*${named("env")}\s*:(.*)$`);
  for (let i = from; i < to; i += 1) {
    const flow = indentOf(lines[i]) === indent ? flowEnv.exec(lines[i]) : null;
    if (flow && isEmptyFlowMapping(flow[1])) continue;
    if (flow && isFlowMapping(flow[1])) throw refuseFlowMapping("env", flow[1]);
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
  return /^ {2}["']?[A-Za-z_][\w-]*["']?\s*:(\s*#.*)?\s*$/.test(line);
}

/** The job id from a header line, with quotes and any inline comment removed. */
function jobIdFrom(line) {
  return line
    .replace(/\s*#.*$/, "")
    .trim()
    .replace(/\s*:$/, "")
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
 * Is this line a sequence entry? A `-` followed by whitespace or nothing: the
 * step's keys may follow on the same line (`- name: A`, `-   name: A`) or on
 * the lines below a bare `-`. Anything narrower misses an entry, and since a
 * non-entry line on the sequence's indent ends the sequence, a missed entry
 * would hide every step after it.
 */
function isSequenceEntry(line) {
  return /^\s*-(\s|$)/.test(line);
}

/**
 * The line indices of a job's steps, found via its `steps:` key, and where
 * the steps sequence ends: `{ starts, end }`.
 *
 * `starts` is [] for a job with no `steps:` (a `uses:` reusable-workflow
 * call), which is correct: it has none. `end` is then the job's end.
 */
function stepIndices(lines, jobStart, jobEnd) {
  let stepsKey = -1;
  for (let i = jobStart + 1; i < jobEnd; i += 1) {
    if (indentOf(lines[i]) === 4 && new RegExp(String.raw`^\s*${named("steps")}\s*:\s*(#.*)?$`).test(lines[i])) {
      stepsKey = i;
      break;
    }
  }
  if (stepsKey === -1) return { starts: [], end: jobEnd };

  const first = lines.slice(stepsKey + 1, jobEnd).find(isSequenceEntry);
  if (!first) return { starts: [], end: jobEnd };
  const seqIndent = indentOf(first);

  // `end` is where the sequence stops: a job key written after `steps:`
  // (`services:`, `outputs:`) is not part of the last step.
  const starts = [];
  let end = jobEnd;
  for (let i = stepsKey + 1; i < jobEnd; i += 1) {
    const indent = indentOf(lines[i]);
    // Below the sequence, or a non-`- ` line on its own indent: the latter is
    // a job key when the sequence sits at the job-key indent (`    - name:`).
    if (indent < seqIndent || (indent === seqIndent && !isSequenceEntry(lines[i]))) {
      end = i;
      break;
    }
    if (indent === seqIndent && isSequenceEntry(lines[i])) starts.push(i);
  }
  return { starts, end };
}

/**
 * The column a step's keys sit at: the column of the first key after its dash
 * (`      - name:` → 8, `      -   name:` → 10, `    - name:` → 6), or, after a
 * bare `-`, the indent of the line below. Every per-step reader works from
 * this rather than a fixed column, which misread any layout but the 6/8 one
 * (#2629): a gated step read as ungated, an env override as no env.
 */
function stepKeyIndent(lines, stepStart, stepEnd) {
  // A `#` after the dash starts a comment, not a key: `- # note` is a bare `-`.
  const onDashLine = /^(\s*-\s+)[^\s#]/.exec(lines[stepStart]);
  if (onDashLine) return onDashLine[1].length;
  return stepStart + 1 < stepEnd ? indentOf(lines[stepStart + 1]) : indentOf(lines[stepStart]) + 2;
}

/**
 * A step's `name:`, wherever it sits in the step.
 *
 * `- name: X` is the common form, but `name:` may follow `- uses:`/`- run:`,
 * and a step may have none — in which case it is identified by its first key so
 * a failure message still points somewhere real.
 */
function stepName(lines, stepStart, stepEnd, keyIndent) {
  const first = lines[stepStart].trim().replace(/^-\s*/, "").replace(/^#.*$/, "");
  const nameKey = new RegExp(String.raw`^${named("name")}\s*:\s*`);
  if (nameKey.test(first)) return scalarValue(first.replace(nameKey, ""));
  for (let i = stepStart + 1; i < stepEnd; i += 1) {
    if (indentOf(lines[i]) === keyIndent && nameKey.test(lines[i].trim())) {
      return scalarValue(lines[i].trim().replace(nameKey, ""));
    }
  }
  // Named by its first key, which sits on the line below a bare `-`.
  const firstKey = first !== "" ? first : (lines[stepStart + 1] ?? "").trim();
  return `<unnamed: ${firstKey.split(":")[0]}>`;
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
function stepIf(lines, stepStart, stepEnd, keyIndent) {
  for (let i = stepStart; i < stepEnd; i += 1) {
    const atStepKeyIndent =
      i === stepStart
        ? new RegExp(String.raw`^\s*-\s+${named("if")}\s*:\s*`).test(lines[i])
        : indentOf(lines[i]) === keyIndent && new RegExp(String.raw`^\s*${named("if")}\s*:\s*`).test(lines[i]);
    if (!atStepKeyIndent) continue;

    // A trailing `# …` is a comment, including after a block indicator
    // (`if: >- # note`), which would otherwise be returned as the condition.
    const inline = withoutComment(lines[i].replace(new RegExp(String.raw`^\s*-?\s*${named("if")}\s*:\s*`), ""));
    if (inline !== "" && !isBlockScalarHeader(inline)) return inline;

    // Block scalar: the condition is the deeper-indented lines beneath it.
    //
    // The base is the step's key indent, not the line's own. For the
    // FIRST-key form (`- if: >-`) the dash sits left of the step's sibling
    // keys, so using the dash's indent as the base never breaks and folds
    // `name:`, `env:` and `run:` into the condition — which makes a correct
    // REHEARSED step fail and lets a swallowed line satisfy a SHIPPING match.
    const base = keyIndent;
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
 * A step's own `env:`, wherever it sits: as a later key (at the step's key
 * indent, see `stepKeyIndent`), or as the
 * step's first key (`- env:`), which a scan from the line after the dash never
 * sees and which would otherwise read as no env at all.
 */
function stepEnvAt(lines, stepStart, stepEnd, keyIndent) {
  const firstKey = new RegExp(String.raw`^\s*-\s+${named("env")}\s*:(.*)$`).exec(lines[stepStart]);
  if (firstKey) {
    if (isEmptyFlowMapping(firstKey[1])) return new Map();
    if (isFlowMapping(firstKey[1])) throw refuseFlowMapping("env", firstKey[1]);
    // The step's other keys sit at its key indent; the env's children deeper.
    if (opensMapping(firstKey[1])) return envMapAt(lines, stepStart, keyIndent);
  }
  const index = findEnvHeader(lines, stepStart + 1, stepEnd, keyIndent);
  return index === -1 ? new Map() : envMapAt(lines, index);
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
    // Reading the sequence indent rather than hardcoding 6 also FINDS the
    // steps of the `    steps:` / `    - name:` style, which is valid YAML and
    // which the old form parsed as zero steps, dropping a whole workflow out
    // of the contract check while the floor stayed green. Each step's keys are
    // then read at that step's own key indent (`stepKeyIndent`).
    const { starts: stepStarts, end: stepsEnd } = stepIndices(lines, jobStart, jobEnd);

    for (let s = 0; s < stepStarts.length; s += 1) {
      const stepStart = stepStarts[s];
      // Bounded by the steps SEQUENCE, not by the job or the file: the last
      // step must absorb neither the next job nor a job key after `steps:`.
      const stepEnd = s + 1 < stepStarts.length ? stepStarts[s + 1] : stepsEnd;

      const keyIndent = stepKeyIndent(lines, stepStart, stepEnd);
      const stepEnv = stepEnvAt(lines, stepStart, stepEnd, keyIndent);

      steps.push({
        workflowFile,
        jobId,
        name: stepName(lines, stepStart, stepEnd, keyIndent),
        if: stepIf(lines, stepStart, stepEnd, keyIndent),
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
 * (`outputs: # the verdict`). `scalarValue(raw) === ""` can't be asked: a
 * quoted empty string (`key: ""`) reads as `""` too, and opens nothing.
 */
function opensMapping(raw) {
  return /^\s*(#.*)?$/.test(raw);
}

/**
 * The keys at exactly `indent` within `[from, to)`, read the way `env:` is.
 *
 * An inline scalar comes back as a string (`needs: [a, b]` → `"[a, b]"`, quotes
 * and a trailing comment removed); a block mapping (`outputs:`, with or
 * without an inline comment) comes back as a flat Map of its immediate
 * children, so `outputs:`, `permissions:` and `environment:` can be asserted
 * key by key rather than by a regex over the text.
 *
 * A non-empty flow mapping (`permissions: { contents: read }`) THROWS; an
 * empty one (`{}`) reads as an empty Map, since it hides nothing. Splitting one by
 * hand is a YAML parser by accretion: #2431's review found a new valid shape
 * it misread in every round (quoted `#`, anchors, tags, verbatim tags,
 * explicit keys, values spanning lines), and a misread value lets a guard
 * pass on a scope it never saw. No committed workflow writes one, so the
 * guarded files use the block form and the reader says so when they don't.
 * Decided on the RAW value, before quotes are stripped, so `'{ Nightly }'`
 * stays the string it is (`isFlowMapping`). `findEnvHeader` refuses a flow
 * `env:` the same way, for the step env `workflowSteps` reads.
 */
function keysAt(lines, from, to, indent) {
  const keys = new Map();
  for (let i = from; i < to; i += 1) {
    if (indentOf(lines[i]) !== indent) continue;
    const match = lines[i].match(new RegExp(String.raw`^\s*${KEY}\s*:(.*)$`));
    if (!match) continue;
    const key = keyOf(match);
    if (opensMapping(match[4])) {
      keys.set(key, envMapAt(lines, i));
    } else if (isEmptyFlowMapping(match[4])) {
      keys.set(key, new Map());
    } else if (isFlowMapping(match[4])) {
      throw refuseFlowMapping(key, match[4]);
    } else {
      keys.set(key, scalarValue(match[4]));
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
      const inline = withoutComment(lines[i].replace(ifKey, ""));
      if (inline !== "" && !isBlockScalarHeader(inline)) {
        condition = inline;
      } else {
        const parts = [];
        for (let k = i + 1; k < to && indentOf(lines[k]) > 4; k += 1) parts.push(lines[k].trim());
        condition = parts.join(" ").trim() || null;
      }
      break;
    }
    jobs.push({
      jobId: jobIdFrom(lines[from]),
      if: condition,
      // Lazy, so a caller that reads only `jobId` and `if` is never refused
      // over a flow mapping it doesn't look at.
      get keys() {
        return keysAt(lines, from + 1, to, 4);
      },
    });
  }
  return jobs;
}
