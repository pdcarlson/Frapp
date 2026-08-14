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
export async function findAlertIssues({
  token,
  repo,
  fetchImpl,
  title,
  lookupLabel = DEFAULT_LOOKUP_LABEL,
}) {
  const found = [];
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
    if (!ok || !Array.isArray(data)) break;
    for (const issue of data) {
      // The issues endpoint returns PRs too; they are never an alert.
      if (!issue.pull_request && issue.title === title) found.push(issue);
    }
    if (data.length < 100) break;
  }
  return found;
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
        labels,
        body: buildIssueBody(),
      },
    });
    return ok
      ? { action: "created", issueNumber: data?.number ?? null }
      : { action: "failed", issueNumber: null };
  }

  const reopened = target.state !== "open";
  if (reopened) {
    await ghRequest({
      token,
      fetchImpl,
      method: "PATCH",
      path: `/repos/${repo}/issues/${target.number}`,
      body: { state: "open" },
    });
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
  return { action: "closed", closed };
}
