import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CANDIDATE_TAG,
  buildService,
  deployCloudRun,
  pinnedSecrets,
  revisionName,
  servingTargets,
  trafficForDeploy,
} from "../deploy-cloud-run.mjs";
import { deployerAccessToken, providerAudience } from "../lib/gcp.mjs";

/**
 * The staging API's Cloud Run deploy (#5228). These pin what keeps a bad
 * revision from taking traffic: the candidate tag at 0%, the check before the
 * traffic move, and the pinned secret versions.
 */

const SHA = "0123456789abcdef0123456789abcdef01234567";
const PROVIDER = "projects/123/locations/global/workloadIdentityPools/github/providers/frapplive-frapp";
const DEPLOYER = "frapp-deployer@nonprod-1.iam.gserviceaccount.com";
const SERVICE_NAME = "projects/nonprod-1/locations/us-east4/services/frapp-api";
const OIDC_ENV = {
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.example/id?api-version=2.0",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-token",
};

const json = (status, body) => new Response(body === undefined ? "" : JSON.stringify(body), { status });
const noSleep = { now: () => 0, sleep: async () => {} };
const quiet = { log() {} };

/** A fake Google: routes by method and URL, records every call. */
function fakeGoogle({ service = null, secrets = [], versions = {} } = {}) {
  const calls = [];
  let current = service;
  const fetchImpl = async (url, init = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, url: String(url), body });
    const u = new URL(String(url));
    if (u.host === "token.actions.example") return json(200, { value: "oidc-jwt" });
    if (u.host === "sts.googleapis.com") return json(200, { access_token: "federated" });
    if (u.host === "iamcredentials.googleapis.com") return json(200, { accessToken: "deployer-token" });
    if (u.host === "secretmanager.googleapis.com") {
      if (u.pathname.endsWith("/secrets")) return json(200, { secrets: secrets.map((id) => ({ name: `projects/1/secrets/${id}` })) });
      const id = u.pathname.split("/secrets/")[1].split("/")[0];
      const version = versions[id];
      if (!version) return json(404, { error: { message: "not found" } });
      return json(200, { name: `projects/1/secrets/${id}/versions/${version.n}`, state: version.state ?? "ENABLED" });
    }
    if (u.host === "run.googleapis.com") {
      if (method === "GET" && u.pathname.includes("/operations/")) return json(200, { name: "op", done: true });
      if (method === "GET") return current ? json(200, current) : json(404, {});
      if (method === "PATCH") {
        const revision = body.template.revision;
        const traffic = body.traffic.map((t) => ({
          ...t,
          revision: t.type.endsWith("LATEST") ? revision : t.revision,
          uri: t.tag ? `https://${t.tag}---frapp-api-x.a.run.app` : undefined,
        }));
        current = {
          ...body,
          name: SERVICE_NAME,
          uri: "https://frapp-api-x.a.run.app",
          latestReadyRevision: `${SERVICE_NAME}/revisions/${revision}`,
          trafficStatuses: traffic,
        };
        return json(200, { name: "projects/nonprod-1/locations/us-east4/operations/op", done: false });
      }
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
  return { fetchImpl, calls };
}

const baseArgs = (overrides = {}) => ({
  project: "nonprod-1",
  region: "us-east4",
  service: "frapp-api",
  runtimeAccount: "frapp-api-runtime@nonprod-1.iam.gserviceaccount.com",
  deployerAccount: DEPLOYER,
  provider: PROVIDER,
  minInstances: 0,
  maxInstances: 1,
  image: `us-east4-docker.pkg.dev/nonprod-1/frapp/api@sha256:${"a".repeat(64)}`,
  sha: SHA,
  env: OIDC_ENV,
  clock: noSleep,
  logger: quiet,
  now: () => 1_700_000_000_000,
  ...overrides,
});

describe("sign-in", () => {
  it("trades GitHub's token for the deployer's, through the provider's default audience", async () => {
    const { fetchImpl, calls } = fakeGoogle();
    assert.equal(await deployerAccessToken({ provider: PROVIDER, serviceAccount: DEPLOYER, env: OIDC_ENV, fetchImpl }), "deployer-token");
    const oidc = new URL(calls[0].url);
    assert.equal(oidc.searchParams.get("audience"), providerAudience(PROVIDER));
    assert.equal(oidc.searchParams.get("api-version"), "2.0");
    assert.equal(calls[1].body.audience, `//iam.googleapis.com/${PROVIDER}`);
    assert.equal(calls[1].body.subjectToken, "oidc-jwt");
    assert.match(calls[2].url, /serviceAccounts\/frapp-deployer%40nonprod-1\.iam\.gserviceaccount\.com:generateAccessToken$/);
  });

  it("names the missing permission when GitHub gave the job no token URL", async () => {
    await assert.rejects(deployerAccessToken({ provider: PROVIDER, serviceAccount: DEPLOYER, env: {} }), /id-token: write/);
  });
});

describe("pinnedSecrets", () => {
  it("pins each secret to its current version, leaving out PORT and any without an enabled version", async () => {
    const { fetchImpl } = fakeGoogle({
      secrets: ["PORT", "SUPABASE_URL", "EMPTY_ONE", "OLD_ONE", "API_URL"],
      versions: { PORT: { n: 1 }, SUPABASE_URL: { n: 4 }, API_URL: { n: 2 }, OLD_ONE: { n: 3, state: "DISABLED" } },
    });
    const { pinned, skipped } = await pinnedSecrets({ project: "nonprod-1", token: "t", fetchImpl });
    assert.deepEqual(pinned, [
      { id: "API_URL", version: "2" },
      { id: "SUPABASE_URL", version: "4" },
    ]);
    assert.deepEqual(
      skipped.map((s) => s.id),
      ["EMPTY_ONE", "OLD_ONE", "PORT"],
    );
  });
});

describe("traffic", () => {
  it("sends a first deploy straight to the latest revision", () => {
    assert.deepEqual(trafficForDeploy(null, "frapp-api-new"), [{ type: "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST", percent: 100 }]);
  });

  it("keeps traffic where it is and tags the new revision at 0%", () => {
    const existing = {
      latestReadyRevision: `${SERVICE_NAME}/revisions/frapp-api-old`,
      trafficStatuses: [{ type: "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST", percent: 100 }],
    };
    assert.deepEqual(trafficForDeploy(existing, "frapp-api-new"), [
      { type: "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION", revision: "frapp-api-old", percent: 100 },
      { type: "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION", revision: "frapp-api-new", percent: 0, tag: CANDIDATE_TAG },
    ]);
  });

  it("treats a service with no ready revision as serving nothing", () => {
    const existing = { trafficStatuses: [{ type: "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST", percent: 100 }] };
    assert.deepEqual(servingTargets(existing), []);
  });
});

describe("buildService", () => {
  it("is public without an IAM binding, keeps the CPU on, and reads each secret at its pinned version", () => {
    const body = buildService({
      runtimeAccount: "rt@p.iam.gserviceaccount.com",
      image: "img@sha256:x",
      revision: "frapp-api-0123456-abc",
      sha: SHA.toUpperCase(),
      minInstances: 0,
      maxInstances: 1,
      secrets: [{ id: "API_URL", version: "2" }],
      traffic: [],
    });
    assert.equal(body.invokerIamDisabled, true);
    assert.deepEqual(body.template.scaling, { minInstanceCount: 0, maxInstanceCount: 1 });
    assert.equal(body.template.labels.commit, SHA);
    const [container] = body.template.containers;
    assert.equal(container.resources.cpuIdle, false);
    assert.deepEqual(container.ports, [{ name: "http1", containerPort: 3001 }]);
    assert.deepEqual(container.env, [{ name: "API_URL", valueSource: { secretKeyRef: { secret: "API_URL", version: "2" } } }]);
  });

  it("names revisions after the service and the commit, short enough for Cloud Run", () => {
    const name = revisionName("frapp-api", SHA, 1_700_000_000_000);
    assert.match(name, /^frapp-api-0123456-[a-z0-9]{1,6}$/);
    assert.ok(name.length <= 63);
  });
});

describe("deployCloudRun", () => {
  const existingService = () => ({
    name: SERVICE_NAME,
    uri: "https://frapp-api-x.a.run.app",
    latestReadyRevision: `${SERVICE_NAME}/revisions/frapp-api-old`,
    trafficStatuses: [{ type: "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION", revision: "frapp-api-old", percent: 100 }],
  });
  const google = () => fakeGoogle({ service: existingService(), secrets: ["API_URL"], versions: { API_URL: { n: 2 } } });

  it("checks the tagged revision, then moves traffic, then checks the service", async () => {
    const { fetchImpl, calls } = google();
    const checked = [];
    const verify = async ({ healthUrl }) => (checked.push(healthUrl), { status: "success", message: "ok" });
    const result = await deployCloudRun(baseArgs({ fetchImpl, verify }));
    assert.deepEqual(checked, ["https://candidate---frapp-api-x.a.run.app/health", "https://frapp-api-x.a.run.app/health"]);
    const writes = calls.filter((c) => c.method === "PATCH");
    assert.equal(writes.length, 2);
    assert.equal(new URL(writes[0].url).searchParams.get("allowMissing"), "true");
    assert.equal(writes[0].body.traffic.find((t) => t.tag === CANDIDATE_TAG).percent, 0);
    assert.deepEqual(writes[1].body.traffic, [
      { type: "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION", revision: result.revision, percent: 100 },
    ]);
    assert.equal(result.url, "https://frapp-api-x.a.run.app");
  });

  it("leaves traffic on the old revision when the new one never serves the commit", async () => {
    const { fetchImpl, calls } = google();
    const verify = async () => ({ status: "failure", message: "did not serve it." });
    await assert.rejects(deployCloudRun(baseArgs({ fetchImpl, verify })), /previous revision still serves/);
    assert.equal(calls.filter((c) => c.method === "PATCH").length, 1);
  });

  it("refuses to deploy with no secrets, before writing anything", async () => {
    const { fetchImpl, calls } = fakeGoogle({ service: existingService() });
    await assert.rejects(deployCloudRun(baseArgs({ fetchImpl })), /holds no usable secret/);
    assert.equal(calls.filter((c) => c.method === "PATCH").length, 0);
  });

  it("sends a first deploy's traffic at once and checks the service URL", async () => {
    const { fetchImpl, calls } = fakeGoogle({ secrets: ["API_URL"], versions: { API_URL: { n: 1 } } });
    const checked = [];
    const verify = async ({ healthUrl }) => (checked.push(healthUrl), { status: "success", message: "ok" });
    await deployCloudRun(baseArgs({ fetchImpl, verify }));
    assert.deepEqual(checked, ["https://frapp-api-x.a.run.app/health"]);
    assert.equal(calls.filter((c) => c.method === "PATCH").length, 1);
  });
});
