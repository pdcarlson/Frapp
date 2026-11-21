#!/usr/bin/env node

// Deploy ONE image to the API's Cloud Run service, prove the new revision
// serves the commit before it takes traffic, then move traffic to it (#5228).
//
// ── The order ───────────────────────────────────────────────────────────────
// 1. Sign in as the project's `frapp-deployer` (lib/gcp.mjs).
// 2. Read every secret in the project's Secret Manager, which Infisical's sync
//    fills, and pin each to its current version. Cloud Run reads a secret when
//    an instance starts, so a pinned version is what keeps a value from
//    changing under a running service: a change in Infisical reaches the API
//    at its next deploy, as it did on Render.
// 3. Write the whole service with a new, named revision. On an existing
//    service the traffic stays where it was and the new revision gets the
//    `candidate` tag, with no traffic.
// 4. Poll `candidate.<API host>/health/ready` until it reports DEPLOY_SHA
//    (verify-served-commit.mjs). If it never does, drop the tag, so the
//    failed revision answers nowhere, and stop: the old revision is still
//    serving.
// 5. Move all traffic to the new revision, dropping the tag. The workflow's
//    next step checks the API host serves the commit.
//
// A first deploy has nothing to protect, so it sends traffic to the latest
// revision at once.
//
// Before any write, the candidate host has to resolve: without its DNS record
// (scripts/gcp/load-balancer.sh prints it) the check could never pass, and
// the write would already have changed the service.
//
// ── Why every check goes through the load balancer ──────────────────────────
// The service takes only the balancer's traffic (ingress
// INTERNAL_LOAD_BALANCER, #5269), so its `run.app` addresses, the tag's
// included, refuse a request from anywhere else, this job too. One public
// path is what lets TRUST_PROXY_HOPS be exact. The balancer sends
// `candidate.<API host>` to the tagged revision (scripts/gcp/load-balancer.sh)
// and the API host itself to whatever takes traffic.
//
// ── Why the whole service each time ─────────────────────────────────────────
// The deploy owns the service's shape (instances, CPU, account, port, secrets),
// so a setting changed by hand in the console is put back on the next deploy
// rather than drifting. The shape lives in `buildService` and in
// .github/environments.json.
//
// ── Why plain REST rather than gcloud ───────────────────────────────────────
// No CLI to install or pin, the same fetch helpers as the Vercel
// deploy, and every decision here is a pure function the tests drive.
//
// Env inputs (all required): GCP_PROJECT_ID, GCP_REGION, CLOUD_RUN_SERVICE,
// CLOUD_RUN_RUNTIME, CLOUD_RUN_DEPLOYER, CLOUD_RUN_PROVIDER,
// CLOUD_RUN_MIN_INSTANCES, CLOUD_RUN_MAX_INSTANCES, API_HEALTHCHECK_URL (the
// API's public `/health`, from Infisical), IMAGE_REF (a digest reference), DEPLOY_SHA, and
// ENV_BASELINE (the names recorded before the Infisical injection). Optional: SERVICE_LABEL, GITHUB_OUTPUT (gets `url=`
// and `revision=`).
//
// Unit tests: `scripts/ci/__tests__/deploy-cloud-run.test.mjs`.

import { lookup } from "node:dns/promises";
import { appendFileSync, readFileSync } from "node:fs";

import { requireEnv } from "./lib/env.mjs";
import { deployerAccessToken, readGoogleJson } from "./lib/gcp.mjs";
import { parseEnvBaseline } from "./lib/vercel-build-env.mjs";
import { fetchWithRetry } from "./lib/http.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";
import { createClock, pollUntilTerminal } from "./lib/polling.mjs";
import { verifyServedCommit } from "./verify-served-commit.mjs";

/** The tag a new revision answers on before it takes traffic. */
export const CANDIDATE_TAG = "candidate";

/**
 * Where the balancer serves the tagged revision: the API's own `/health` URL
 * with `candidate.` in front of its host (scripts/gcp/load-balancer.sh).
 */
export function candidateHealthUrl(healthUrl) {
  const url = new URL(healthUrl);
  if (url.protocol !== "https:") throw new Error(`API_HEALTHCHECK_URL must be https (got ${healthUrl}).`);
  url.hostname = `${CANDIDATE_TAG}.${url.hostname}`;
  return url.toString();
}
/** The port the API listens on (apps/api/Dockerfile `EXPOSE`). */
const CONTAINER_PORT = 3001;
/**
 * Names Cloud Run sets itself and refuses as variables. Infisical still holds
 * PORT from when the API ran on Render; Cloud Run sets it to the declared port.
 */
const RESERVED_ENV_NAMES = new Set(["PORT", "K_SERVICE", "K_REVISION", "K_CONFIGURATION"]);
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RUN_API = "https://run.googleapis.com/v2";
const SECRETS_API = "https://secretmanager.googleapis.com/v1";
const OPERATION_POLL_INTERVAL_MS = 5_000;
const OPERATION_TIMEOUT_MS = 10 * 60 * 1000;
const LATEST = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST";
const REVISION = "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION";

const shortName = (resource) => (typeof resource === "string" ? resource.split("/").pop() : "");


function authed(token, init = {}) {
  return { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, Accept: "application/json" } };
}

/**
 * Every secret in the project, pinned to its current version. A secret with
 * no enabled version, or a name that can't be a variable, is left out and
 * named in `skipped`, so the log says what the API won't see.
 *
 * `infisicalKeys`, when given, is what Infisical holds now. Its sync never
 * deletes a secret (deletion protection, SECRETS_MANAGEMENT.md § Cloud Run
 * API), so one removed in Infisical stays in Secret Manager; it is left out
 * here, as Render dropped a variable Infisical stopped syncing.
 */
export async function pinnedSecrets({ project, token, infisicalKeys = null, fetchImpl = fetch }) {
  const names = [];
  let pageToken = "";
  do {
    const url = new URL(`${SECRETS_API}/projects/${project}/secrets`);
    url.searchParams.set("pageSize", "250");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const body = await readGoogleJson(await fetchWithRetry(url.toString(), authed(token), { fetchImpl }), "Secret Manager's list");
    for (const secret of body.secrets ?? []) names.push(secret.name);
    pageToken = body.nextPageToken ?? "";
  } while (pageToken);

  const pinned = [];
  const skipped = [];
  for (const resource of names.sort()) {
    const id = shortName(resource);
    if (RESERVED_ENV_NAMES.has(id)) {
      skipped.push({ id, reason: "Cloud Run sets it" });
      continue;
    }
    if (!ENV_NAME_PATTERN.test(id)) {
      skipped.push({ id, reason: "not a variable name" });
      continue;
    }
    if (infisicalKeys && !infisicalKeys.has(id)) {
      skipped.push({ id, reason: "no longer in Infisical" });
      continue;
    }
    const response = await fetchWithRetry(`${SECRETS_API}/${resource}/versions/latest`, authed(token), { fetchImpl });
    if (response.status === 404) {
      skipped.push({ id, reason: "no version" });
      continue;
    }
    const version = await readGoogleJson(response, `Secret Manager, for ${id}`);
    if (version.state !== "ENABLED") {
      skipped.push({ id, reason: `latest version is ${version.state ?? "unknown"}` });
      continue;
    }
    pinned.push({ id, version: shortName(version.name) });
  }
  return { pinned, skipped };
}

/**
 * The names the Infisical injection added to the job: everything set now that
 * the baseline, recorded just before it, did not hold.
 */
export function injectedNames(env, baselineText) {
  const baseline = parseEnvBaseline(baselineText);
  return new Set(Object.keys(env).filter((name) => !baseline.has(name)));
}

/** A digest reference, never a tag: a tag can be pushed again between push and deploy. */
export function assertDigestRef(image) {
  if (!/@sha256:[0-9a-f]{64}$/.test(image)) {
    throw new Error(`IMAGE_REF must name an image by digest, not tag (got ${image}).`);
  }
  return image;
}

/** `frapp-api-<sha7>-<time>`: unique per deploy, and says which commit it runs. */
export function revisionName(service, sha, now = Date.now()) {
  return `${service}-${sha.slice(0, 7).toLowerCase()}-${now.toString(36).slice(-6)}`;
}

/** The revision names serving traffic now, with their percents. Empty when none is ready. */
export function servingTargets(existing) {
  if (!existing) return [];
  const targets = [];
  for (const status of existing.trafficStatuses ?? []) {
    if (!status.percent) continue;
    const revision = status.type === LATEST ? shortName(existing.latestReadyRevision) : status.revision;
    if (!revision) return [];
    targets.push({ revision, percent: status.percent });
  }
  return targets;
}

/**
 * Traffic for the write that creates the new revision: unchanged, with the new
 * revision tagged and at 0, or straight to it when nothing serves yet.
 */
export function trafficForDeploy(existing, newRevision) {
  const serving = servingTargets(existing);
  if (serving.length === 0) return [{ type: LATEST, percent: 100 }];
  return [
    ...serving.map(({ revision, percent }) => ({ type: REVISION, revision, percent })),
    { type: REVISION, revision: newRevision, percent: 0, tag: CANDIDATE_TAG },
  ];
}

/** The service as the deploy owns it. */
export function buildService({ runtimeAccount, image, revision, sha, minInstances, maxInstances, secrets, traffic }) {
  return {
    // Only the load balancer reaches the service, so the API has one public
    // path and one X-Forwarded-For chain to trust (#5269).
    ingress: "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER",
    // The API does its own auth; this lets the balancer's callers in without
    // an allUsers binding, which the organization's sharing policy would refuse.
    invokerIamDisabled: true,
    template: {
      revision,
      labels: { commit: sha.toLowerCase() },
      serviceAccount: runtimeAccount,
      scaling: { minInstanceCount: minInstances, maxInstanceCount: maxInstances },
      containers: [
        {
          name: "api",
          image,
          ports: [{ name: "http1", containerPort: CONTAINER_PORT }],
          // cpuIdle false is instance-based billing: the CPU stays on between
          // requests, which the sweeps and chat workers need (cloud-run.md).
          resources: { limits: { cpu: "1", memory: "1Gi" }, cpuIdle: false, startupCpuBoost: true },
          env: [
            // /health's `commit`, which every deploy check reads. Images built
            // since #5203 carry it too, but an older commit's image doesn't,
            // and Render used to set it at runtime, so a rollback that far
            // back would otherwise never verify.
            { name: "RENDER_GIT_COMMIT", value: sha.toLowerCase() },
            ...secrets
              .filter(({ id }) => id !== "RENDER_GIT_COMMIT")
              .map(({ id, version }) => ({ name: id, valueSource: { secretKeyRef: { secret: id, version } } })),
          ],
        },
      ],
    },
    traffic,
  };
}

/** Poll a long-running operation until it is done; throw on its error or the deadline. */
async function waitForOperation({ operation, token, what, fetchImpl = fetch, clock = createClock(), logger = console }) {
  if (operation.done) {
    if (operation.error) throw new Error(`${what} failed: ${operation.error.message ?? JSON.stringify(operation.error)}`);
    return operation;
  }
  const result = await pollUntilTerminal({
    clock,
    logger,
    pollIntervalMs: OPERATION_POLL_INTERVAL_MS,
    overallTimeoutMs: OPERATION_TIMEOUT_MS,
    fetchOne: async () => {
      try {
        return await readGoogleJson(await fetchWithRetry(`${RUN_API}/${operation.name}`, authed(token), { fetchImpl }), what);
      } catch (error) {
        return { readError: error.message };
      }
    },
    classify: (state) => {
      if (state.readError) {
        logger.log?.(`${what}: could not read the operation (${state.readError}); asking again.`);
        return null;
      }
      if (!state.done) return null;
      if (state.error) {
        return { status: "failure", message: `${what} failed: ${state.error.message ?? JSON.stringify(state.error)}` };
      }
      return { status: "success", message: `${what} finished.` };
    },
    onTimeout: () => ({
      status: "failure",
      message: `${what} did not finish within ${OPERATION_TIMEOUT_MS / 60000} minutes (${operation.name}).`,
    }),
  });
  if (result.status !== "success") throw new Error(result.message);
  return result;
}

async function getService({ name, token, fetchImpl }) {
  const response = await fetchWithRetry(`${RUN_API}/${name}`, authed(token), { fetchImpl });
  if (response.status === 404) return null;
  return readGoogleJson(response, `Cloud Run, reading ${shortName(name)}`);
}

async function writeService({ name, body, token, what, fetchImpl, clock, logger }) {
  const url = new URL(`${RUN_API}/${name}`);
  url.searchParams.set("allowMissing", "true");
  // A write isn't retried: a lost answer to a write that went through would
  // make a second, conflicting one. The operation poll is the retry.
  const response = await fetchWithRetry(
    url.toString(),
    authed(token, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    { fetchImpl },
  );
  const operation = await readGoogleJson(response, what);
  await waitForOperation({ operation, token, what, fetchImpl, clock, logger });
}

export async function deployCloudRun({
  project,
  region,
  service,
  runtimeAccount,
  deployerAccount,
  provider,
  minInstances,
  maxInstances,
  image,
  sha,
  healthUrl,
  infisicalKeys = null,
  label = "Cloud Run",
  env = process.env,
  fetchImpl = fetch,
  clock = createClock(),
  logger = console,
  verify = verifyServedCommit,
  resolveHost = (host) => lookup(host),
  now = Date.now,
}) {
  const name = `projects/${project}/locations/${region}/services/${service}`;
  // Checked before anything is written: a bad address fails here, not after
  // the write has changed the service.
  const candidateUrl = candidateHealthUrl(healthUrl);
  const token = await deployerAccessToken({ provider, serviceAccount: deployerAccount, env, fetchImpl });

  const { pinned, skipped } = await pinnedSecrets({ project, token, infisicalKeys, fetchImpl });
  if (pinned.length === 0) {
    throw new Error(`Secret Manager in ${project} holds no usable secret. Check Infisical's sync into this project.`);
  }
  logger.log?.(`[${label}] ${pinned.length} secrets pinned to their current versions.`);
  for (const { id, reason } of skipped) logger.log?.(`[${label}] Left out ${id}: ${reason}.`);

  const existing = await getService({ name, token, fetchImpl });
  const revision = revisionName(service, sha, now());
  const traffic = trafficForDeploy(existing, revision);
  const guarded = traffic.length > 1;
  if (guarded) {
    const host = new URL(candidateUrl).hostname;
    try {
      await resolveHost(host);
    } catch (error) {
      throw new Error(
        `${host} doesn't resolve (${error.code ?? error.message}), so the new revision couldn't be checked before it ` +
          `takes traffic. Add the candidateRecord scripts/gcp/load-balancer.sh prints (cloud-run.md § Address). Nothing was written.`,
      );
    }
  }
  const body = buildService({ runtimeAccount, image, revision, sha, minInstances, maxInstances, secrets: pinned, traffic });
  logger.log?.(
    `[${label}] Writing ${service} with revision ${revision} (${image})` +
      (guarded ? `, tagged ${CANDIDATE_TAG} with no traffic.` : existing ? ", taking traffic at once: no revision serves yet." : ", a new service."),
  );
  await writeService({ name, body, token, what: `Deploying ${revision}`, fetchImpl, clock, logger });

  if (guarded) {
    const written = await getService({ name, token, fetchImpl });
    const candidate = (written?.trafficStatuses ?? []).find((status) => status.tag === CANDIDATE_TAG);
    if (candidate?.revision !== revision) throw new Error(`Cloud Run reports no ${CANDIDATE_TAG} tag on ${revision}.`);
    const checked = await verify({ healthUrl: candidateUrl, sha, label: `${label} ${CANDIDATE_TAG}`, clock, logger });
    if (checked.status !== "success") {
      // Drop the tag, so the failed revision, which holds every secret, stops
      // answering on the public candidate host. Best effort: the run fails anyway.
      const untagged = { ...body, traffic: traffic.filter((target) => !target.tag), etag: written.etag };
      try {
        await writeService({ name, body: untagged, token, what: `Dropping the ${CANDIDATE_TAG} tag`, fetchImpl, clock, logger });
      } catch (error) {
        logger.log?.(`[${label}] Could not drop the ${CANDIDATE_TAG} tag (${error.message}); it moves at the next deploy.`);
      }
      throw new Error(`${checked.message} Traffic was not moved: the previous revision still serves.`);
    }
    // The same service with only the traffic changed. The template still
    // names this revision, so no new one is made, and the etag refuses the
    // write if anything changed the service since it was read.
    const promoted = { ...body, traffic: [{ type: REVISION, revision, percent: 100 }], etag: written.etag };
    await writeService({ name, body: promoted, token, what: `Moving traffic to ${revision}`, fetchImpl, clock, logger });
  }

  logger.log?.(`[${label}] ${revision} takes all traffic.`);
  return { url: healthUrl, revision };
}

// ── CLI entry ───────────────────────────────────────────────────────────────

function wholeNumber(name) {
  const value = Number(requireEnv(name));
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a whole number.`);
  return value;
}

async function main() {
  const image = assertDigestRef(requireEnv("IMAGE_REF"));
  const result = await deployCloudRun({
    project: requireEnv("GCP_PROJECT_ID"),
    region: requireEnv("GCP_REGION"),
    service: requireEnv("CLOUD_RUN_SERVICE"),
    runtimeAccount: requireEnv("CLOUD_RUN_RUNTIME"),
    deployerAccount: requireEnv("CLOUD_RUN_DEPLOYER"),
    provider: requireEnv("CLOUD_RUN_PROVIDER"),
    minInstances: wholeNumber("CLOUD_RUN_MIN_INSTANCES"),
    maxInstances: wholeNumber("CLOUD_RUN_MAX_INSTANCES"),
    image,
    sha: requireEnv("DEPLOY_SHA"),
    healthUrl: requireEnv("API_HEALTHCHECK_URL"),
    infisicalKeys: injectedNames(process.env, readFileSync(requireEnv("ENV_BASELINE"), "utf8")),
    label: process.env.SERVICE_LABEL ?? "Cloud Run",
  });
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `url=${result.url}\nrevision=${result.revision}\n`);
  }
  console.log(`✅ ${result.revision} takes ${result.url}'s traffic.`);
}

if (isInvokedDirectly(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}
