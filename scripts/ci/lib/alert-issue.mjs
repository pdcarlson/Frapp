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
// `routine-state` is the lookup label for every alert: `/next` §0.2 treats it as
// never-claimable, which is what stops agent sessions picking an alert up as if
// it were backlog work.

import { ghRequest } from "../ci-wake.mjs";

export const DEFAULT_LOOKUP_LABEL = "routine-state";

// Pages of issues to scan when locating an alert.
const MAX_ISSUE_PAGES = 5;

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
  lookupLabel = DEFAULT_LOOKUP_LABEL,
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
  lookupLabel = DEFAULT_LOOKUP_LABEL,
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
    const { ok, data } = await ghRequest({
      token,
      fetchImpl,
      method: "POST",
      path: `/repos/${repo}/issues`,
      body: {
        title,
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
        body: buildIssueBody(null),
      },
    });
    return ok
      ? { action: "created", issueNumber: data?.number ?? null }
      : { action: "failed", issueNumber: null };
  }

  const reopened = target.state !== "open";
  let bodyRefreshFailed = false;
  const patch = {};
  if (reopened) patch.state = "open";
  // The previous body is handed to the builder so a caller can merge state it
  // keeps there (see staging-conformance.mjs's failing-assertion marker)
  // instead of clobbering it with only what is true this run.
  //
  // On a REOPEN the previous body is deliberately withheld: the alert was
  // closed, and a close is proof that everything the old body recorded had
  // recovered. Carrying that state into a new incident resurrects a settled
  // gate, and any of those items that cannot be asserted now would keep the
  // new alert open forever.
  if (refreshBodyOnRaise) patch.body = buildIssueBody(reopened ? null : (target.body ?? null));
  if (Object.keys(patch).length > 0) {
    const { ok: patchOk } = await ghRequest({
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
 */
export async function resolveAlert({
  token,
  repo,
  fetchImpl,
  title,
  lookupLabel = DEFAULT_LOOKUP_LABEL,
  buildRecoveryBody,
}) {
  const openIssues = (
    await findAlertIssues({ token, repo, fetchImpl, title, lookupLabel })
  ).filter((issue) => issue.state === "open");
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
  // `action: "closed"` must mean something actually closed. Returning it with
  // an empty list let the caller log a successful closure while a P1 stayed
  // open on a healthy environment, re-posting "recovered" every run.
  if (closed.length === 0) return { action: "failed", closed };
  return { action: "closed", closed };
}
