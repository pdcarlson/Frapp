// Thin HTTP wrappers around the Render and Vercel deployment-listing APIs,
// plus the readers and state vocabulary for the Vercel rows they return. The
// wrappers accept an injectable `fetchImpl` so tests can replay canned responses.

const RENDER_DEPLOYS_URL = (serviceId, cursor) =>
  `https://api.render.com/v1/services/${serviceId}/deploys?limit=10` +
  (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");

const VERCEL_DEPLOYMENTS_URL = (projectId, until, { teamId, limit = 20 } = {}) =>
  `https://api.vercel.com/v6/deployments?projectId=${projectId}&limit=${limit}` +
  (teamId ? `&teamId=${encodeURIComponent(teamId)}` : "") +
  (until ? `&until=${until}` : "");

// A single un-paginated page (20 Vercel deployments) is only the newest slice.
// Re-running an old verify job after enough newer deployments have landed
// means the SHA it is looking for has fallen off that page, which used to read
// as "no deployment exists" (#1377). The finder below pages back,
// newest-first, bounded by `maxPages` rather than walking all the way to a
// project's first deployment ever.
const DEFAULT_MAX_PAGES = 5;

/**
 * `fetch` a URL, throw on a non-2xx, return the parsed JSON body.
 *
 * This was three near-identical copies (`fetchRenderDeploys` and
 * `fetchVercelDeployments` below, plus `production-guardrails.mjs`'s
 * `readJson`), differing only in the error-message template (#1351). `what`
 * supplies that template's subject so the thrown message still names what
 * failed to read, without each call site re-writing the ok-check.
 */
export async function fetchJson({ url, headers, what, fetchImpl = fetch }) {
  const response = await fetchImpl(url, { headers });
  if (!response.ok) {
    throw new Error(`${what} returned HTTP ${response.status}`);
  }
  return response.json();
}

export async function fetchRenderDeploys({ apiKey, serviceId, cursor, fetchImpl = fetch }) {
  // `what` names the service up front rather than rewrapping the result in a
  // `.catch`: a rewrap would swallow the original stack trace (and the
  // original error's identity — a network throw, a malformed-JSON
  // SyntaxError) for every failure, not just the intended non-2xx case.
  return fetchJson({
    url: RENDER_DEPLOYS_URL(serviceId, cursor),
    headers: { Authorization: `Bearer ${apiKey}` },
    what: `Render API for service ${serviceId}`,
    fetchImpl,
  });
}

export async function fetchVercelDeployments({ apiKey, projectId, until, teamId, limit, fetchImpl = fetch }) {
  return fetchJson({
    url: VERCEL_DEPLOYMENTS_URL(projectId, until, { teamId, limit }),
    headers: { Authorization: `Bearer ${apiKey}` },
    what: `Vercel API for project ${projectId}`,
    fetchImpl,
  });
}

/** Vercel's list rows carry `created` (epoch ms); some historical/test
 *  shapes carry `createdAt` (ISO). Shared so the pager and every caller that
 *  sorts or cuts off deployments agree on which field wins. */
export function vercelDeploymentCreatedAt(deployment) {
  return new Date(deployment?.createdAt ?? deployment?.created ?? 0).getTime();
}

/** A deployment's state. Vercel reports it under two names (docs read
 *  2026-09-30): its list-deployments schema requires `readyState` and also
 *  returns an optional `state` with the same values, and the single-deployment
 *  endpoint `deploy-vercel.mjs` polls (`GET /v13/deployments/:id`) returns
 *  `readyState` and no `state` at all, so there the fallback is the whole read.
 *  Neither is documented as legacy, and fixtures here carry either spelling,
 *  so read `state` and fall back to `readyState`. That is the order four of
 *  the five copies this replaced used (#1778); `production-release-pin.mjs`
 *  read `readyState` first, which differs only for a row whose two fields
 *  disagree, and none has been seen.
 *  Shared for the same reason as `vercelDeploymentCreatedAt`: an API change
 *  should be one edit, not one per caller. */
export function vercelDeploymentState(deployment) {
  return deployment?.state ?? deployment?.readyState;
}

// Terminal deployment states. A caller decides what each means for it:
// `deploy-vercel.mjs` fails a deployment it created on CANCELED, and
// `ensure-vercel-staging-alias.mjs` reads CANCELED as "nothing to alias".
export const VERCEL_TERMINAL_SUCCESS_STATES = new Set(["READY"]);
export const VERCEL_TERMINAL_FAILURE_STATES = new Set(["ERROR"]);
// Neither a successful build nor a build failure: Vercel produced no deployed
// output, without erroring.
export const VERCEL_NEUTRAL_TERMINAL_STATES = new Set(["CANCELED"]);

/**
 * Page back through Vercel's deployments list looking for `sha`, bounded by
 * `maxPages`. The API is newest-first; `pagination.next` is an epoch-ms
 * cursor passed back as `until` on the next call.
 *
 * `exhausted: true` means pagination reached the true end of this project's
 * deployment history with no match — a genuinely absent deployment.
 * `exhausted: false` with no match means `maxPages` was reached first —
 * older history may still hold the match; the caller ran out of budget, not
 * evidence.
 */
export async function findVercelDeploymentBySha({
  apiKey,
  projectId,
  sha,
  maxPages = DEFAULT_MAX_PAGES,
  fetchImpl = fetch,
}) {
  const deployments = [];
  let until;
  let pagesSearched = 0;
  let oldestSeenMs = null;

  while (pagesSearched < maxPages) {
    const body = await fetchVercelDeployments({ apiKey, projectId, until, fetchImpl });
    // A malformed page (not the shape Vercel's API actually returns) must not
    // read as "zero deployments on this page" — that would trip the
    // `!until || batch.length === 0` exhaustion check below and report a
    // false, confident "searched all N pages, no match" instead of the
    // honest "could not read" this deserves.
    if (!Array.isArray(body?.deployments)) {
      throw new Error(
        `Vercel API for project ${projectId} returned an unexpected payload (page ${pagesSearched + 1})`,
      );
    }
    const batch = body.deployments;
    deployments.push(...batch);
    pagesSearched += 1;
    for (const deployment of batch) {
      const at = vercelDeploymentCreatedAt(deployment);
      if (oldestSeenMs === null || at < oldestSeenMs) oldestSeenMs = at;
    }

    const matches = deployments.filter((deployment) => deployment?.meta?.githubCommitSha === sha);
    if (matches.length > 0) {
      return { deployments, matches, pagesSearched, oldestSeenMs, exhausted: false };
    }

    until = body?.pagination?.next;
    if (!until || batch.length === 0) {
      return { deployments, matches: [], pagesSearched, oldestSeenMs, exhausted: true };
    }
  }

  return { deployments, matches: [], pagesSearched, oldestSeenMs, exhausted: false };
}
