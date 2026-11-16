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
//    `candidate` tag, its own URL with no traffic.
// 4. Poll that URL's `/health/ready` until it reports DEPLOY_SHA
//    (verify-served-commit.mjs). If it never does, stop: the old revision is
//    still serving.
// 5. Move all traffic to the new revision, dropping the tag, and check the
//    service's own URL the same way.
//
// A first deploy has nothing to protect, so it sends traffic to the latest
// revision at once and checks the service URL.
//
// ── Why the whole service each time ─────────────────────────────────────────
// The deploy owns the service's shape (instances, CPU, account, port, secrets),
// so a setting changed by hand in the console is put back on the next deploy
// rather than drifting. The shape lives in `buildService` and in
// .github/environments.json.
//
// ── Why plain REST rather than gcloud ───────────────────────────────────────
// No CLI to install or pin, the same fetch helpers as the Render and Vercel
// deploys, and every decision here is a pure function the tests drive.
//
// Env inputs (all required): GCP_PROJECT_ID, GCP_REGION, CLOUD_RUN_SERVICE,
// CLOUD_RUN_RUNTIME, CLOUD_RUN_DEPLOYER, CLOUD_RUN_PROVIDER,
// CLOUD_RUN_MIN_INSTANCES, CLOUD_RUN_MAX_INSTANCES, IMAGE_REF (a digest
// reference), DEPLOY_SHA. Optional: SERVICE_LABEL, GITHUB_OUTPUT (gets `url=`
// and `revision=`).
//
// Unit tests: `scripts/ci/__tests__/deploy-cloud-run.test.mjs`.

import { appendFileSync } from "node:fs";

import { requireEnv } from "./lib/env.mjs";
import { deployerAccessToken } from "./lib/gcp.mjs";
import { fetchWithRetry } from "./lib/http.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";
import { createClock, pollUntilTerminal } from "./lib/polling.mjs";
import { verifyServedCommit } from "./verify-served-commit.mjs";

/** The tag a new revision answers on before it takes traffic. */
export const CANDIDATE_TAG = "candidate";
/** The port the API listens on (apps/api/Dockerfile `EXPOSE`). */
const CONTAINER_PORT = 3001;
/**
 * Names Cloud Run sets itself and refuses as variables. Infisical holds PORT
 * for Render, which reads it; Cloud Run sets it to the declared port.
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

async function readJson(response, what) {
  const text = await response.text();
  if (!response.ok) throw new Error(`${what} answered HTTP ${response.status}: ${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : {};
}

function authed(token, init = {}) {
  return { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, Accept: "application/json" } };
}

/**
 * Every secret in the project, pinned to its current version. A secret with
 * no enabled version, or a name that can't be a variable, is left out and
 * named in `skipped`, so the log says what the API won't see.
 */
export async function pinnedSecrets({ project, token, fetchImpl = fetch }) {
  const names = [];
  let pageToken = "";
  do {
    const url = new URL(`${SECRETS_API}/projects/${project}/secrets`);
    url.searchParams.set("pageSize", "250");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const body = await readJson(await fetchWithRetry(url.toString(), authed(token), { fetchImpl }), "Secret Manager's list");
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
    const response = await fetchWithRetry(`${SECRETS_API}/${resource}/versions/latest`, authed(token), { fetchImpl });
    if (response.status === 404) {
      skipped.push({ id, reason: "no version" });
      continue;
    }
    const version = await readJson(response, `Secret Manager, for ${id}`);
    if (version.state !== "ENABLED") {
      skipped.push({ id, reason: `latest version is ${version.state ?? "unknown"}` });
      continue;
    }
    pinned.push({ id, version: shortName(version.name) });
  }
  return { pinned, skipped };
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
    ingress: "INGRESS_TRAFFIC_ALL",
    // The API does its own auth; this makes it public without an allUsers
    // binding, which the organization's sharing policy would refuse.
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
          env: secrets.map(({ id, version }) => ({ name: id, valueSource: { secretKeyRef: { secret: id, version } } })),
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
        return await readJson(await fetchWithRetry(`${RUN_API}/${operation.name}`, authed(token), { fetchImpl }), what);
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
  return readJson(response, `Cloud Run, reading ${shortName(name)}`);
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
  const operation = await readJson(response, what);
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
  label = "Cloud Run",
  env = process.env,
  fetchImpl = fetch,
  clock = createClock(),
  logger = console,
  verify = verifyServedCommit,
  now = Date.now,
}) {
  const name = `projects/${project}/locations/${region}/services/${service}`;
  const token = await deployerAccessToken({ provider, serviceAccount: deployerAccount, env, fetchImpl });

  const { pinned, skipped } = await pinnedSecrets({ project, token, fetchImpl });
  if (pinned.length === 0) {
    throw new Error(`Secret Manager in ${project} holds no usable secret. Check Infisical's sync into this project.`);
  }
  logger.log?.(`[${label}] ${pinned.length} secrets pinned to their current versions.`);
  for (const { id, reason } of skipped) logger.log?.(`[${label}] Left out ${id}: ${reason}.`);

  const existing = await getService({ name, token, fetchImpl });
  const revision = revisionName(service, sha, now());
  const traffic = trafficForDeploy(existing, revision);
  const guarded = traffic.length > 1;
  const body = buildService({ runtimeAccount, image, revision, sha, minInstances, maxInstances, secrets: pinned, traffic });
  logger.log?.(
    `[${label}] Writing ${service} with revision ${revision} (${image})` +
      (guarded ? `, tagged ${CANDIDATE_TAG} with no traffic.` : existing ? ", taking traffic at once: no revision serves yet." : ", a new service."),
  );
  await writeService({ name, body, token, what: `Deploying ${revision}`, fetchImpl, clock, logger });

  if (guarded) {
    const written = await getService({ name, token, fetchImpl });
    const candidate = (written?.trafficStatuses ?? []).find((status) => status.tag === CANDIDATE_TAG);
    if (!candidate?.uri) throw new Error(`Cloud Run reports no URL for the ${CANDIDATE_TAG} tag on ${revision}.`);
    const checked = await verify({ healthUrl: `${candidate.uri}/health`, sha, label: `${label} ${CANDIDATE_TAG}`, clock, logger });
    if (checked.status !== "success") {
      throw new Error(`${checked.message} Traffic was not moved: the previous revision still serves.`);
    }
    // The same service with only the traffic changed. The template still
    // names this revision, so no new one is made, and the etag refuses the
    // write if anything changed the service since it was read.
    const promoted = { ...body, traffic: [{ type: REVISION, revision, percent: 100 }], etag: written.etag };
    await writeService({ name, body: promoted, token, what: `Moving traffic to ${revision}`, fetchImpl, clock, logger });
  }

  const served = await getService({ name, token, fetchImpl });
  if (!served?.uri) throw new Error(`Cloud Run reports no URL for ${service}.`);
  const checked = await verify({ healthUrl: `${served.uri}/health`, sha, label, clock, logger });
  if (checked.status !== "success") throw new Error(checked.message);
  logger.log?.(`[${label}] ${checked.message}`);
  return { url: served.uri, revision };
}

// ── CLI entry ───────────────────────────────────────────────────────────────

function wholeNumber(name) {
  const value = Number(requireEnv(name));
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a whole number.`);
  return value;
}

async function main() {
  const image = requireEnv("IMAGE_REF");
  if (!/@sha256:[0-9a-f]{64}$/.test(image)) {
    throw new Error(`IMAGE_REF must name an image by digest, not tag (got ${image}).`);
  }
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
    label: process.env.SERVICE_LABEL ?? "Cloud Run",
  });
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `url=${result.url}\nrevision=${result.revision}\n`);
  }
  console.log(`✅ ${result.revision} serves ${result.url}.`);
}

if (isInvokedDirectly(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}
