#!/usr/bin/env node
// Posts the advisory `codex review` result as ONE plain PR comment
// (.github/workflows/codex-review.yml). ADR-14's 2026-09-18 amendment decided
// this reviewer; the 2026-09-18 implementation amendment records the executed
// CLI behaviour the logic below is built around.
//
// Advisory means: never a required check (absent from
// scripts/ci/lib/required-checks.mjs), never a GitHub *review* event — a
// write-access CHANGES_REQUESTED blocks squash and no agent can clear it
// (#1875) — and never a red workflow for a reviewer problem. Reviewer trouble
// raises ONE `routine-state` alert issue instead, the same pattern every other
// non-required workflow here uses.
//
// ── Why the classification below looks the way it does ──────────────────────
// `codex review` was executed against a local Responses-API stub (CLI 0.155.0;
// no provider is reachable from an agent sandbox, but 127.0.0.1 is). What it
// actually does:
//
//   * It sends a strict-JSON schema in its SYSTEM PROMPT and `text.format` is
//     null — the contract is PROMPT-enforced, never API-enforced. A model that
//     ignores it is not rejected by anything.
//   * It parses that JSON ITSELF and renders Markdown to STDOUT:
//       <overall_explanation>
//
//       Review comment:            <- singular for one finding
//       Full review comments:      <- plural for two or more
//
//       - [P0] title — /abs/path:12-14
//         body
//     The banner, warnings and turn transcript go to STDERR, so stdout is the
//     payload. There is no --json and no --output-schema on `review`.
//   * When the model does NOT emit the schema, stdout is its raw prose,
//     VERBATIM, and the exit code is still 0.
//
// That last point is the whole problem, and it is why `contractOk` exists.
// A clean review renders as short prose ("No issues found.") and a model that
// ignored the contract also renders as short prose ("Sure! Looks fine!").
// **The two are indistinguishable from stdout alone** — both non-empty, both
// exit 0. So stdout cannot carry the liveness signal by itself, and
// `No findings.`-style text must never be read as proof the reviewer worked.
// The raw pre-render model message is recovered from the session rollout and
// checked against the schema instead; when that cannot be read we degrade to
// "assume clean" and say so rather than inventing a verdict.
//
// Executed exit codes worth knowing: 101 when the provider env key is missing,
// 1 on a config error (a reserved built-in provider id, or an unknown key under
// --strict-config), and a HANG on an unreachable base_url — it retries rather
// than failing fast, which is why the workflow wraps the call in `timeout`.
//
// Env inputs:
//   GITHUB_TOKEN        — required (issues: write)
//   GITHUB_REPOSITORY   — required, owner/repo
//   PR_NUMBER           — required
//   HEAD_SHA            — required, the reviewed commit
//   CODEX_STDOUT_FILE   — required, captured stdout
//   CODEX_EXIT_CODE     — required
//   CODEX_HOME          — optional, for the raw-message contract check
//   GITHUB_WORKSPACE    — optional, stripped from absolute paths
//   GITHUB_SERVER_URL / GITHUB_RUN_ID — optional, for the run link
//   REVIEW_MODEL        — optional, shown in the comment footer
//
// Exits 0 on every handled outcome; 1 only on unexpected internal errors.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ghRequest } from "./lib/github.mjs";
import { requireEnv } from "./lib/env.mjs";
import { upsertWakeComment, clearMarkedComments } from "./ci-wake.mjs";
import { raiseAlert, resolveAlert } from "./lib/alert-issue.mjs";

/** Per-workflow comment marker, so this reviewer only ever replaces its own. */
export const CODEX_REVIEW_MARKER = "<!-- frapp-codex-review -->";

/** GitHub rejects an issue-comment body over this many characters. */
export const MAX_COMMENT_CHARS = 65536;

/** Alert identity is its exact title within `routine-state`; do not rename. */
export const ALERT_TITLE = "Advisory codex review is not producing reviews";

// A rendered finding line. The section HEADER wording differs between the
// singular and plural cases and is a rendering detail that could change, so the
// bullet is what we key on.
const RENDERED_FINDING_LINE = /^- \[P[0-3]\] /m;

// Fenced blocks and inline spans are matched as whole segments so the mention
// break below is never injected into code a reader is meant to copy.
const CODE_SEGMENT = /(^```[^\n]*\n[\s\S]*?^```[ \t]*$|`[^`\n]+`)/m;

// An empty HTML comment: GitHub strips it when rendering, so `@<!---->octocat`
// reads as `@octocat` but resolves to no user, team or cross-reference.
const BREAK = "<!---->";

/** True when Codex rendered at least one structured finding. */
export function hasRenderedFindings(stdout) {
  return RENDERED_FINDING_LINE.test(stdout ?? "");
}

/**
 * Break `@mentions` and issue/PR cross-references outside code.
 *
 * Model output is quoted diff hunks and prose. Posted through the repo's bot it
 * would otherwise notify whoever `@name` resolves to and back-link every
 * `owner/repo#N` onto an unrelated thread — a defect ADR-14 carries forward
 * from #2396, and one I reproduced: a finding body containing `@octocat` and
 * `owner/repo#42` came through the renderer completely untouched.
 */
export function sanitizeMentions(text) {
  return String(text ?? "")
    .split(CODE_SEGMENT)
    .map((segment) => {
      if (segment.startsWith("```") || segment.startsWith("`")) return segment;
      return (
        segment
          // @user, @org/team
          .replace(/@(?=[A-Za-z0-9])/g, `@${BREAK}`)
          // #123 and the #N half of owner/repo#123
          .replace(/#(?=\d)/g, `#${BREAK}`)
          // GH-123 is also auto-linked
          .replace(/\bGH-(?=\d)/g, `GH-${BREAK}`)
      );
    })
    .join("");
}

/**
 * Rewrite runner-absolute paths to repo-relative ones.
 *
 * The reviewer's schema requires `absolute_file_path`, so every rendered
 * location arrives as `/home/runner/work/Frapp/Frapp/apps/api/src/x.ts`. Left
 * alone it is unreadable in a comment and not clickable.
 */
export function relativizePaths(text, workspace) {
  if (!workspace) return String(text ?? "");
  // Trailing-slash and bare forms, longest first.
  return String(text ?? "")
    .split(`${workspace}/`)
    .join("")
    .split(workspace)
    .join(".");
}

/**
 * The newest pre-render model message from the session rollout, or null.
 *
 * `codex review` records the model's raw text as an `event_msg` of type
 * `agent_message` before it renders anything, which is the only place the
 * un-rendered reply survives. The rollout layout is Codex-internal
 * (CODEX_HOME/sessions/<y>/<m>/<d>/rollout-*.jsonl, and a run writes more than
 * one file), so every failure here returns null and the caller degrades rather
 * than treating "I could not read it" as "the reviewer is broken".
 */
export function findRawModelMessage(codexHome, deps = {}) {
  const fs = {
    existsSync,
    readdirSync,
    statSync,
    readFileSync,
    ...deps,
  };
  if (!codexHome) return null;
  const sessionsRoot = join(codexHome, "sessions");
  if (!fs.existsSync(sessionsRoot)) return null;

  const rollouts = [];
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.name.endsWith(".jsonl")) {
        try {
          rollouts.push({ full, mtime: fs.statSync(full).mtimeMs });
        } catch {
          /* raced away; ignore */
        }
      }
    }
  };
  walk(sessionsRoot, 0);
  if (!rollouts.length) return null;

  rollouts.sort((a, b) => b.mtime - a.mtime);
  for (const { full } of rollouts) {
    let lines;
    try {
      lines = fs.readFileSync(full, "utf8").split("\n");
    } catch {
      continue;
    }
    // Last agent_message in the newest rollout that has one.
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i].trim();
      if (!line) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      const payload = record?.payload;
      if (payload?.type === "agent_message" && typeof payload.message === "string") {
        return payload.message;
      }
    }
  }
  return null;
}

/**
 * Did the model honour the strict-JSON review contract?
 *
 * true / false / null where null means "could not tell" — the rollout was
 * unreadable, so no claim is made either way.
 */
export function checkContract(rawMessage) {
  if (typeof rawMessage !== "string" || rawMessage.trim() === "") return null;
  // The contract says no fences, but tolerate them: a model that wraps
  // otherwise-valid JSON honoured the schema, which is what we are measuring.
  const unfenced = rawMessage
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  let parsed;
  try {
    parsed = JSON.parse(unfenced);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object") return false;
  return Array.isArray(parsed.findings) && typeof parsed.overall_correctness === "string";
}

/**
 * Decide what to do with one reviewer run. Pure.
 *
 * `contractOk` is `checkContract`'s tri-state. Note that it is only consulted
 * when stdout carried no rendered findings: rendered findings are themselves
 * proof the model produced parseable schema output, so a rollout we failed to
 * read must not downgrade a real review.
 */
export function classifyReview({ exitCode, stdout, contractOk = null }) {
  const text = String(stdout ?? "");

  if (Number(exitCode) !== 0) {
    return {
      verdict: "reviewer-failed",
      shouldPost: false,
      shouldAlert: true,
      reason:
        `codex review exited ${exitCode}. Executed meanings: 101 = the provider ` +
        `env key is missing, 1 = a config error, 124 = the timeout fired (an ` +
        `unreachable base_url makes it retry rather than fail).`,
    };
  }

  if (text.trim() === "") {
    return {
      verdict: "empty-output",
      shouldPost: false,
      shouldAlert: true,
      reason:
        "codex review exited 0 but wrote nothing to stdout. A reviewer that " +
        "emits no payload is dead, not clean.",
    };
  }

  if (hasRenderedFindings(text)) {
    return {
      verdict: "findings",
      shouldPost: true,
      shouldAlert: false,
      reason: "Codex rendered at least one structured finding.",
    };
  }

  if (contractOk === false) {
    return {
      verdict: "contract-violation",
      shouldPost: false,
      shouldAlert: true,
      reason:
        "stdout carried prose rather than rendered findings, and the raw model " +
        "message is not the required JSON. The output schema is prompt-enforced " +
        "only (text.format is null), so this is the model ignoring it — which is " +
        "byte-indistinguishable from a clean review on stdout alone.",
    };
  }

  return {
    verdict: contractOk === true ? "clean" : "clean-unverified",
    shouldPost: false,
    shouldAlert: false,
    reason:
      contractOk === true
        ? "The model returned schema-valid JSON with no findings."
        : "No findings rendered, and the raw model message could not be read to " +
          "confirm the contract. Treated as clean; not asserted as verified.",
  };
}

/** Cap a body at GitHub's limit, keeping the head and saying what was dropped. */
export function capBody(body, limit = MAX_COMMENT_CHARS) {
  const text = String(body ?? "");
  if (text.length <= limit) return text;
  const notice = "\n\n---\n\n_Truncated: the review exceeded GitHub's comment size limit._";
  return text.slice(0, Math.max(0, limit - notice.length)) + notice;
}

/** The advisory comment. `review` is Codex's rendered stdout. */
export function buildCommentBody({ review, headSha, runUrl, model, workspace }) {
  const cleaned = sanitizeMentions(relativizePaths(review, workspace));
  const lines = [
    CODEX_REVIEW_MARKER,
    "### Advisory code review",
    "",
    "Automated, **advisory only** — it blocks nothing and is not a required " +
      "check. The merge-quality gate is the local `.githooks/pre-push` + " +
      "`/diff-review` path (ADR-14). Findings are the model's opinion: verify " +
      "before acting, and ignore what does not apply.",
    "",
    `Reviewed \`${headSha}\`.`,
    "",
    "---",
    "",
    cleaned.trim(),
  ];
  if (runUrl || model) {
    lines.push("", "---", "");
    const bits = [];
    if (model) bits.push(`Model: \`${model}\``);
    if (runUrl) bits.push(`[Workflow run](${runUrl})`);
    lines.push(`<sub>${bits.join(" · ")}</sub>`);
  }
  return capBody(lines.join("\n"));
}

/** Body for the liveness alert issue. */
export function buildAlertBody({ verdict, reason, runUrl, prNumber, stdoutHead }) {
  return [
    "The advisory `codex review` workflow is not producing reviews.",
    "",
    `**Verdict:** \`${verdict}\``,
    "",
    reason,
    "",
    "This reviewer is advisory, so the workflow stays green and this issue is " +
      "the only signal. Nothing is blocked by it — the merge-quality gate is " +
      "still the local `.githooks/pre-push` + `/diff-review` path.",
    "",
    "**Where to look**",
    "",
    "- `OPENROUTER_API_KEY` is set as a repository secret (exit 101 means it is not).",
    "- The model slug is a real OpenRouter id, including the vendor prefix " +
      "(`meta/muse-spark-1.3`, not `muse-spark-1.3`).",
    "- OpenRouter's Responses endpoint is reachable. `codex review` requires " +
      "`wire_api = \"responses\"`; `\"chat\"` was removed in CLI 0.155.0, so " +
      "there is no wire-protocol fallback.",
    "- A `contract-violation` verdict is about the MODEL, not the wiring: the " +
      "output schema is prompt-enforced only. ADR-14's revisit trigger for this " +
      "is to price the native Codex reviewer's credits path.",
    "",
    prNumber ? `First seen on PR #${prNumber}.` : "",
    runUrl ? `[Workflow run](${runUrl})` : "",
    stdoutHead
      ? ["", "<details><summary>First bytes of stdout</summary>", "", "```", stdoutHead, "```", "", "</details>"].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Orchestration for one reviewer run. Everything network-bound is injectable. */
export async function postReview({
  token,
  repo,
  prNumber,
  headSha,
  exitCode,
  stdout,
  codexHome,
  workspace,
  runUrl,
  model,
  fetchImpl = fetch,
  logger = console,
}) {
  const contractOk = checkContract(findRawModelMessage(codexHome));
  const classification = classifyReview({ exitCode, stdout, contractOk });
  logger.log?.(
    `[codex-review] PR #${prNumber} ${headSha}: ${classification.verdict} — ${classification.reason}`,
  );

  if (classification.shouldAlert) {
    // Do not leave a stale review comment standing over a run that failed:
    // the last good review would read as current for this head.
    await clearMarkedComments({
      token,
      repo,
      prNumber,
      marker: CODEX_REVIEW_MARKER,
      fetchImpl,
    });
    await raiseAlert({
      token,
      repo,
      fetchImpl,
      title: ALERT_TITLE,
      labels: ["routine-state"],
      refreshBodyOnRaise: true,
      buildIssueBody: () =>
        buildAlertBody({
          verdict: classification.verdict,
          reason: classification.reason,
          runUrl,
          prNumber,
          stdoutHead: String(stdout ?? "").slice(0, 800),
        }),
      buildCommentBody: () =>
        `Still failing on PR #${prNumber} (\`${headSha}\`): \`${classification.verdict}\`.` +
        (runUrl ? ` [Run](${runUrl})` : ""),
    });
    return { ...classification, commented: false, alerted: true };
  }

  // A run that produced a verdict means the reviewer is alive again.
  await resolveAlert({
    token,
    repo,
    fetchImpl,
    title: ALERT_TITLE,
    buildRecoveryBody: () =>
      `Recovered: the advisory reviewer produced \`${classification.verdict}\` on ` +
      `PR #${prNumber} (\`${headSha}\`).` + (runUrl ? ` [Run](${runUrl})` : ""),
  });

  if (!classification.shouldPost) {
    // Clean: clear this workflow's stale comment so a fixed head stops showing
    // findings that no longer exist, and say nothing new.
    const { found, deleted } = await clearMarkedComments({
      token,
      repo,
      prNumber,
      marker: CODEX_REVIEW_MARKER,
      fetchImpl,
    });
    if (found > deleted) {
      logger.log?.(
        `[codex-review] could not clear ${found - deleted} stale comment(s); next run retries`,
      );
    }
    return { ...classification, commented: false, alerted: false };
  }

  const { posted, status } = await upsertWakeComment({
    token,
    repo,
    prNumber,
    marker: CODEX_REVIEW_MARKER,
    body: buildCommentBody({ review: stdout, headSha, runUrl, model, workspace }),
    fetchImpl,
  });
  if (!posted) logger.log?.(`[codex-review] comment POST failed with ${status}`);
  return { ...classification, commented: posted, alerted: false };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());

if (isMain) {
  const token = requireEnv("GITHUB_TOKEN");
  const repo = requireEnv("GITHUB_REPOSITORY");
  const prNumber = requireEnv("PR_NUMBER");
  const headSha = requireEnv("HEAD_SHA");
  const stdoutFile = requireEnv("CODEX_STDOUT_FILE");
  const exitCode = requireEnv("CODEX_EXIT_CODE");

  let stdout = "";
  try {
    stdout = readFileSync(stdoutFile, "utf8");
  } catch {
    // A missing capture file is itself the empty-output case; classify it.
    stdout = "";
  }

  const serverUrl = process.env.GITHUB_SERVER_URL ?? "https://github.com";
  const runUrl = process.env.GITHUB_RUN_ID
    ? `${serverUrl}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : undefined;

  postReview({
    token,
    repo,
    prNumber,
    headSha,
    exitCode,
    stdout,
    codexHome: process.env.CODEX_HOME,
    workspace: process.env.GITHUB_WORKSPACE,
    runUrl,
    model: process.env.REVIEW_MODEL,
  })
    .then((result) => {
      console.log(`[codex-review] ${JSON.stringify(result)}`);
      // Always 0: an advisory reviewer that reds CI creates the noise it exists
      // to remove, and its failures are carried by the alert issue instead.
      process.exit(0);
    })
    .catch((error) => {
      console.error(`::error::[codex-review] unexpected failure: ${error?.stack ?? error}`);
      process.exit(1);
    });
}
