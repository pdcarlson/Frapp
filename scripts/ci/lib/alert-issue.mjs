// Generic "one tracking issue per alert" upsert, extracted from deploy-alert.mjs
// (#804) so a second scheduled watchdog can reuse the mechanism instead of
// copying it.
//
// The contract these functions implement is the useful part, and it is worth
// stating once: **an open alert issue means the thing it watches is broken right
// now.** That only holds if raising is idempotent (comment on the existing issue,
// never file a second one) and recovery closes every match. Both live here.
//
// The identity of an alert is its exact `title` within the lookup label. Title is
// the primary key, so it must stay stable across releases — renaming one in the
// GitHub UI detaches it and the next failure files a fresh issue rather than
// silently writing to a human-renamed thread.
//
// This module is the one place an alert's label and assignee are set
// (ADR-24 decision 2). Every watchdog derives its lookup label from here rather
// than repeating the literal, because the label is half of each alert's
// identity. A watchdog left on the old label would stop finding its own open
// alert, file a duplicate, and never close the original.
//
// - `incident` is the lookup label for every alert. `/next` §0.2 treats it as
//   never-claimable, which stops agent sessions picking an alert up as if it
//   were backlog work. What an agent may do with one is in
//   docs/ops/alert-routing.md § Escalation.
// - Every new or reopened alert is assigned to the owner. Assignment is a
//   participating notification, so it reaches the owner under every
//   repo-watch setting except Ignore; an unassigned issue reached them only if
//   their watch setting happened to cover new issues.
//
// An alert's identity is declared once, with `defineAlert`, and every function
// here takes that value rather than a loose title and labels (#1731). There is
// no lookup-label parameter anywhere: a watchdog cannot look its alert up, or
// file it, under any label but this module's.

import { ghRequest } from "./github.mjs";
import { ALERT_ROUTING } from "./ops-docs.mjs";

export const ALERT_LOOKUP_LABEL = "incident";
export const ALERT_ASSIGNEE = "pdcarlson";

// Every identity `defineAlert` made. The functions below refuse anything else,
// so an identity can't be assembled by hand with a label of its own or without
// the lookup label, the half-copy #1731 was filed to prevent.
const DEFINED_ALERTS = new WeakSet();

/**
 * One alert's identity: its exact `title`, the lookup key, and the `labels` a
 * new issue is filed with. The lookup label is forced in first, whatever the
 * caller passes, because the issue this files has to be found by it again.
 *
 * The title is checked for the mistakes that would orphan an issue quietly:
 * empty, or with surrounding whitespace GitHub trims from what it stores, so
 * the exact-match lookup would never find the issue it filed.
 */
export function defineAlert({ title, labels = [] }) {
  if (typeof title !== "string" || title === "" || title !== title.trim()) {
    throw new TypeError(`defineAlert needs a non-empty, trimmed title; got ${JSON.stringify(title)}`);
  }
  if (!Array.isArray(labels) || labels.some((label) => typeof label !== "string" || label === "")) {
    throw new TypeError(`defineAlert labels must be non-empty strings; got ${JSON.stringify(labels)}`);
  }
  const alert = Object.freeze({
    title,
    labels: Object.freeze([...new Set([ALERT_LOOKUP_LABEL, ...labels])]),
  });
  DEFINED_ALERTS.add(alert);
  return alert;
}

/** Did `defineAlert` make this value? */
export function isDefinedAlert(alert) {
  return typeof alert === "object" && alert !== null && DEFINED_ALERTS.has(alert);
}

function assertDefinedAlert(alert, caller) {
  if (!isDefinedAlert(alert)) {
    throw new TypeError(`${caller} needs an alert made by defineAlert; got ${JSON.stringify(alert)}`);
  }
}

/**
 * The config named `name` in `table`, for a script that serves several alerts
 * and is told which one at runtime (deploy-alert.mjs's `ALERT_CONFIG`).
 *
 * Throws on a missing OR unknown name, and there is no default. An absent name
 * is the likelier mistake: a workflow copying another's reporting step and
 * dropping the variable would otherwise resolve to some other alert's config
 * and comment on, or close, that alert's live issue. `Object.hasOwn`, not a
 * truthiness check, so an inherited key (`toString`) is unknown too.
 *
 * Every entry must carry its identity as `alert`, made by `defineAlert`, which
 * is what keeps a table from growing a shape of its own.
 */
export function selectAlertConfig(table, name, variable) {
  if (!name || !Object.hasOwn(table, name)) {
    throw new Error(
      `Unknown or missing ${variable} ${JSON.stringify(name ?? null)}. ` +
        `Known configurations: ${Object.keys(table).join(", ")}.`,
    );
  }
  const config = table[name];
  assertDefinedAlert(config?.alert, `${variable} ${JSON.stringify(name)}`);
  return config;
}

// Pages of issues to scan when locating an alert.
const MAX_ISSUE_PAGES = 5;

/**
 * A create or reopen that assigns the owner, retried once without the assignee
 * if GitHub rejects it as unassignable (422).
 *
 * A missing assignee is the lesser failure. The alert itself is the thing this
 * module exists to deliver, so an assignee GitHub won't accept (a renamed
 * account, the repo moved to an org the login isn't in) must not stop every
 * alert from being filed. Only a 422 retries: a 5xx is not about the assignee,
 * and the suites count calls against 5xx fixtures.
 *
 * Either way a lost assignee is annotated on the run, because nothing else
 * would show it: the alert still reads as created or reopened. That covers the
 * 422 retry, and a 2xx whose issue comes back without the owner (GitHub drops
 * assignees it won't accept from some callers rather than rejecting them).
 */
async function writeAssigned({ token, fetchImpl, method, path, body }) {
  const first = await ghRequest({ token, fetchImpl, method, path, body });
  if (first.ok) {
    const assignees = first.data?.assignees;
    if (body.assignees && Array.isArray(assignees) && !assignees.some((u) => u?.login === ALERT_ASSIGNEE)) {
      warnUnassigned(first.data?.number, "GitHub accepted the write but did not assign them");
    }
    return first;
  }
  if (first.status !== 422 || !body.assignees) return first;
  const { assignees: _unassignable, ...unassigned } = body;
  const retry = await ghRequest({ token, fetchImpl, method, path, body: unassigned });
  if (retry.ok) {
    const reason = typeof first.data?.message === "string" ? `: ${first.data.message}` : "";
    warnUnassigned(retry.data?.number, `GitHub refused the assignee (422${reason})`);
  }
  return retry;
}

function warnUnassigned(issueNumber, why) {
  const which = issueNumber ? `#${issueNumber}` : "the alert issue";
  console.log(`::warning::${which} is not assigned to ${ALERT_ASSIGNEE}: ${why}. It was still filed.`);
}

/**
 * Every alert body ends with the same pointer to what an agent may do with it,
 * so the rule reaches whoever reads the issue itself (a phone notification, a
 * Routine, a tool that doesn't load AGENTS.md) and no watchdog has to copy it.
 * The link is absolute because a relative path doesn't resolve in an issue.
 */
export function withAgentNote(body, repo) {
  if (typeof body !== "string") return body;
  const escalation = `https://github.com/${repo}/blob/main/${ALERT_ROUTING}#escalation`;
  return (
    `${body}\n\n---\n_Agents: triage and report on this alert. Don't act on its suggested fix or ` +
    `close it by hand; its watchdog closes it ([why](${escalation}))._`
  );
}

/** The owner added to an issue's current assignees; PATCH replaces the whole set. */
function withOwnerAssigned(issue) {
  const current = (issue.assignees ?? []).map((user) => user?.login).filter(Boolean);
  return [...new Set([...current, ALERT_ASSIGNEE])];
}

// The alert each `findAlertIssuesDetailed` result was read for, so a raise or
// resolve handed that result can refuse one read for a different alert.
const LOOKUP_ALERTS = new WeakMap();

/**
 * Every issue (open or closed) that is this alert, newest first.
 *
 * Returns [] when the lookup fails — a failed lookup then falls through to
 * "create", because a duplicate alert is a better failure mode than silence,
 * and `resolveAlert` closes every match so the duplicate self-heals.
 */
export async function findAlertIssues(options) {
  return (await findAlertIssuesDetailed(options)).issues;
}

/**
 * As `findAlertIssues`, but reports whether the lookup actually succeeded.
 *
 * `findAlertIssues` returning `[]` is ambiguous: it means either "no alert
 * exists" or "the lookup failed". That ambiguity is safe on the raise path —
 * it falls through to create, and a duplicate self-heals — but NOT on any path
 * that decides to close something, where "I could not read the alerts" must
 * never be treated as "there are none to worry about". `resolveAlert` uses this
 * and reports a failed lookup as `unread`; a caller reads it directly only when
 * it needs the issues themselves (a body marker, or whether one is already open).
 */
export async function findAlertIssuesDetailed({ token, repo, fetchImpl, alert }) {
  assertDefinedAlert(alert, "findAlertIssues");
  const found = [];
  let lookupOk = true;
  for (let page = 1; page <= MAX_ISSUE_PAGES; page += 1) {
    const { ok, data } = await ghRequest({
      token,
      fetchImpl,
      // sort/direction are pinned explicitly: raiseAlert treats the first match
      // as the most recent one to reopen, and that must not depend on an
      // unstated API default.
      path:
        `/repos/${repo}/issues?state=all&labels=${encodeURIComponent(ALERT_LOOKUP_LABEL)}` +
        `&sort=created&direction=desc&per_page=100&page=${page}`,
    });
    if (!ok || !Array.isArray(data)) {
      lookupOk = false;
      break;
    }
    for (const issue of data) {
      // The issues endpoint returns PRs too; they are never an alert.
      if (!issue.pull_request && issue.title === alert.title) found.push(issue);
    }
    if (data.length < 100) break;
  }
  const lookup = { issues: found, lookupOk };
  LOOKUP_ALERTS.set(lookup, alert);
  return lookup;
}

/**
 * The alert's issues for a raise or resolve: the caller's `lookup` when it read
 * successfully, and a fresh read otherwise.
 *
 * A watchdog that has to see its alert before deciding what to do (whether one
 * is already open, or which assertions an open one names) used to read it, then
 * call `raiseAlert` or `resolveAlert`, which read the same up-to-5 pages again
 * (#2333). Passing the read through halves the calls. A failed read is still
 * read again: that second look is a retry, the one production-uptime.mjs's
 * comment relies on, not a duplicate.
 *
 * The caller's read must be this run's and must come straight before the raise
 * or resolve, with no write to the alert's issues in between; every caller
 * reads immediately before deciding.
 */
async function lookupFor({ token, repo, fetchImpl, alert, lookup, caller }) {
  if (lookup != null) {
    if (LOOKUP_ALERTS.get(lookup) !== alert) {
      throw new TypeError(
        `${caller} was handed a lookup that findAlertIssuesDetailed did not read for this alert`,
      );
    }
    if (lookup.lookupOk) return lookup;
  }
  return findAlertIssuesDetailed({ token, repo, fetchImpl, alert });
}

/**
 * Create / reopen / comment, whichever the current state calls for.
 *
 * `buildIssueBody()` is used for a first-time create; `buildCommentBody({ reopened })`
 * for every subsequent failure. Returns { action, issueNumber } where action is
 * "created" | "commented" | "reopened" | "failed".
 *
 * `lookup` is the caller's own `findAlertIssuesDetailed` read, when it made one
 * to decide whether to raise at all (see `lookupFor`). A failed lookup still
 * falls through to create, as described at `findAlertIssues`.
 */
export async function raiseAlert({
  token,
  repo,
  fetchImpl,
  alert,
  buildIssueBody,
  buildCommentBody,
  // When true, an existing alert's BODY is rewritten to `buildIssueBody()` on
  // every raise, not just at creation. Opt-in, because it overwrites whatever
  // is there. Callers that encode machine-readable state in the body (see
  // staging-conformance.mjs's failing-assertion marker) need the body to track
  // the current failure set; deploy-alert.mjs does not and leaves this off.
  refreshBodyOnRaise = false,
  lookup,
}) {
  assertDefinedAlert(alert, "raiseAlert");
  const { issues: existing } = await lookupFor({
    token,
    repo,
    fetchImpl,
    alert,
    lookup,
    caller: "raiseAlert",
  });
  // Prefer an open one; otherwise reopen the most recent closed one.
  const open = existing.find((issue) => issue.state === "open");
  const target = open ?? existing[0];

  if (!target) {
    const { ok, data } = await writeAssigned({
      token,
      fetchImpl,
      method: "POST",
      path: `/repos/${repo}/issues`,
      body: {
        title: alert.title,
        assignees: [ALERT_ASSIGNEE],
        // Labels that do not exist yet are created by this call. They always
        // include the lookup label, because `defineAlert` forces it in: an
        // issue filed without it could never be found by `findAlertIssues`,
        // so every run would file a fresh duplicate and none would close.
        labels: [...alert.labels],
        body: withAgentNote(buildIssueBody(null), repo),
      },
    });
    return ok
      ? { action: "created", issueNumber: data?.number ?? null }
      : { action: "failed", issueNumber: null };
  }

  const reopened = target.state !== "open";
  let bodyRefreshFailed = false;
  const patch = {};
  // A reopen is a new incident, so it is assigned like a new alert. A comment
  // on an alert that is already open leaves its assignees alone: if the owner
  // dropped the assignment mid-incident, re-adding it on every run would
  // override that choice.
  if (reopened) {
    patch.state = "open";
    patch.assignees = withOwnerAssigned(target);
  }
  // The previous body is handed to the builder so a caller can merge state it
  // keeps there (see staging-conformance.mjs's failing-assertion marker)
  // instead of clobbering it with only what is true this run.
  //
  // On a REOPEN the previous body is deliberately withheld: the alert was
  // closed, and a close is proof that everything the old body recorded had
  // recovered. Carrying that state into a new incident resurrects a settled
  // gate, and any of those items that cannot be asserted now would keep the
  // new alert open forever.
  if (refreshBodyOnRaise) {
    patch.body = withAgentNote(buildIssueBody(reopened ? null : (target.body ?? null)), repo);
  }
  if (Object.keys(patch).length > 0) {
    const { ok: patchOk } = await writeAssigned({
      token,
      fetchImpl,
      method: "PATCH",
      path: `/repos/${repo}/issues/${target.number}`,
      body: patch,
    });
    // Only a failed REOPEN aborts. It is checked rather than fire-and-forget
    // because reporting "reopened" on an issue that is still closed means a
    // live outage with no open alert — the dangerous direction for this
    // module's contract. A failed body refresh is cosmetic by comparison: the
    // alert is already open and reachable, so bailing out here would suppress
    // the comment that records what actually failed today.
    if (!patchOk && reopened) return { action: "failed", issueNumber: target.number };
    if (!patchOk) bodyRefreshFailed = true;
  }

  const { ok } = await ghRequest({
    token,
    fetchImpl,
    method: "POST",
    path: `/repos/${repo}/issues/${target.number}/comments`,
    body: { body: buildCommentBody({ reopened }) },
  });

  if (!ok) return { action: "failed", issueNumber: target.number };
  return {
    action: reopened ? "reopened" : "commented",
    issueNumber: target.number,
    // Reported only to callers that opted into body refresh, so the return
    // shape stays byte-identical for the ones that did not — which is what
    // keeps deploy-alert.test.mjs a valid regression net over this module.
    ...(refreshBodyOnRaise ? { bodyRefreshFailed } : {}),
  };
}

/**
 * Closes every open issue matching this alert. Closing them all (not just the
 * first) is what makes a duplicate created during an API blip self-heal.
 *
 * Returns { action, closed }, where action is:
 * - "closed": every open match closed (`closed` lists them).
 * - "none": the lookup worked and nothing was open.
 * - "failed": a close left a match open; `closed` lists the ones that did close.
 * - "unread": the lookup failed, so nothing was closed and whether an alert is
 *   open is unknown. A lookup that fails on a later page closes nothing either,
 *   not even the open matches an earlier page returned; the next run with a
 *   clean read closes them. "unread" is kept apart from "failed" because the
 *   callers' policies differ. Every daily watchdog goes red on it (the
 *   conformance pair, check-migration-drift, production-guardrails,
 *   production-backup-env, both backup-freshness watchdogs,
 *   production-release-pin, routine-heartbeat and supabase-quota): one failed
 *   read is usually transient, but a
 *   lasting one means the job's token lost issues access, and then the next
 *   real failure could not raise its alert either. production-uptime passes
 *   with a warning, because at a 15-minute cadence a blip would be constant
 *   noise and the dailies catch a lasting break. deploy-alert and pr-base-sync warn. Whatever its policy, a caller
 *   must never say an alert "is still open" when it could not look.
 *
 * `lookup` is the caller's own `findAlertIssuesDetailed` read, when it made one
 * to decide whether recovery is proven (see `lookupFor`).
 */
export async function resolveAlert({ token, repo, fetchImpl, alert, buildRecoveryBody, lookup }) {
  assertDefinedAlert(alert, "resolveAlert");
  const { issues, lookupOk } = await lookupFor({
    token,
    repo,
    fetchImpl,
    alert,
    lookup,
    caller: "resolveAlert",
  });
  if (!lookupOk) return { action: "unread", closed: [] };
  const openIssues = issues.filter((issue) => issue.state === "open");
  if (openIssues.length === 0) return { action: "none", closed: [] };

  const closed = [];
  for (const issue of openIssues) {
    await ghRequest({
      token,
      fetchImpl,
      method: "POST",
      path: `/repos/${repo}/issues/${issue.number}/comments`,
      body: { body: buildRecoveryBody() },
    });
    const { ok } = await ghRequest({
      token,
      fetchImpl,
      method: "PATCH",
      path: `/repos/${repo}/issues/${issue.number}`,
      body: { state: "closed", state_reason: "completed" },
    });
    if (ok) closed.push(issue.number);
  }
  // `action: "closed"` must mean every match actually closed. Returning it with
  // an empty list let the caller log a successful closure while a P1 stayed
  // open on a healthy environment, re-posting "recovered" every run; returning
  // it after a partial close did the same for the duplicate left open.
  if (closed.length < openIssues.length) return { action: "failed", closed };
  return { action: "closed", closed };
}
