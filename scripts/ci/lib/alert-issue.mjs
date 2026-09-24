// Generic "one tracking issue per alert" upsert, extracted from deploy-alert.mjs
// (#804) so a second scheduled watchdog can reuse the mechanism instead of
// copying it.
//
// The contract these functions implement is the useful part, and it is worth
// stating once: **an open alert issue means the thing it watches is broken right
// now.** That only holds if raising is idempotent (comment on the existing issue,
// never file a second one) and recovery closes every match. Both live here.
//
// The identity of an alert is its exact `title` within `lookupLabel`. Title is
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
//   docs/internal/ops/ALERT_ROUTING.md § Escalation.
// - Every new or reopened alert is assigned to the owner. Assignment is a
//   participating notification, so it reaches the owner under every
//   repo-watch setting except Ignore; an unassigned issue reached them only if
//   their watch setting happened to cover new issues.

import { ghRequest } from "./github.mjs";

export const ALERT_LOOKUP_LABEL = "incident";
export const ALERT_ASSIGNEE = "pdcarlson";

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
  const escalation = `https://github.com/${repo}/blob/main/docs/internal/ops/ALERT_ROUTING.md#escalation`;
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
 * never be treated as "there are none to worry about".
 */
export async function findAlertIssuesDetailed({
  token,
  repo,
  fetchImpl,
  title,
  lookupLabel = ALERT_LOOKUP_LABEL,
}) {
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
        `/repos/${repo}/issues?state=all&labels=${encodeURIComponent(lookupLabel)}` +
        `&sort=created&direction=desc&per_page=100&page=${page}`,
    });
    if (!ok || !Array.isArray(data)) {
      lookupOk = false;
      break;
    }
    for (const issue of data) {
      // The issues endpoint returns PRs too; they are never an alert.
      if (!issue.pull_request && issue.title === title) found.push(issue);
    }
    if (data.length < 100) break;
  }
  return { issues: found, lookupOk };
}

/**
 * Create / reopen / comment, whichever the current state calls for.
 *
 * `buildIssueBody()` is used for a first-time create; `buildCommentBody({ reopened })`
 * for every subsequent failure. Returns { action, issueNumber } where action is
 * "created" | "commented" | "reopened" | "failed".
 */
export async function raiseAlert({
  token,
  repo,
  fetchImpl,
  title,
  labels,
  lookupLabel = ALERT_LOOKUP_LABEL,
  buildIssueBody,
  buildCommentBody,
  // When true, an existing alert's BODY is rewritten to `buildIssueBody()` on
  // every raise, not just at creation. Opt-in, because it overwrites whatever
  // is there. Callers that encode machine-readable state in the body (see
  // staging-conformance.mjs's failing-assertion marker) need the body to track
  // the current failure set; deploy-alert.mjs does not and leaves this off.
  refreshBodyOnRaise = false,
}) {
  const existing = await findAlertIssues({ token, repo, fetchImpl, title, lookupLabel });
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
        title,
        assignees: [ALERT_ASSIGNEE],
        // Labels that do not exist yet are created by this call.
        //
        // `lookupLabel` is forced in rather than trusted from `labels`: this
        // function creates the issue and `findAlertIssues` looks it up by that
        // label, so a caller passing labels that omit it would file an issue
        // its own lookup can never find — a fresh duplicate every run, and
        // never closed on recovery. Before the extraction that was
        // unrepresentable (one hard-coded constant served both roles); keeping
        // it unrepresentable is the point.
        labels: [...new Set([lookupLabel, ...(labels ?? [])])],
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
 * "none" means the lookup worked and nothing was open. A lookup that failed is
 * "failed", never "none": this is a close path, so "I could not read the
 * alerts" must not read as "there were none to close" (see
 * findAlertIssuesDetailed). A close that left any match open is "failed" too,
 * with `closed` listing the ones that did close.
 */
export async function resolveAlert({
  token,
  repo,
  fetchImpl,
  title,
  lookupLabel = ALERT_LOOKUP_LABEL,
  buildRecoveryBody,
}) {
  const lookup = await findAlertIssuesDetailed({ token, repo, fetchImpl, title, lookupLabel });
  if (!lookup.lookupOk) return { action: "failed", closed: [] };
  const openIssues = lookup.issues.filter((issue) => issue.state === "open");
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
