// Google Cloud sign-in for a GitHub Actions job, with no key file (#5228).
//
// The job asks GitHub for an OIDC token, trades it at Google's Security Token
// Service for a federated token, and uses that to mint a one-hour access token
// for the project's `frapp-deployer` account. Google accepts the GitHub token
// only for this repository, its owner and the job's own GitHub environment
// (scripts/gcp/bootstrap.sh sets that condition), so staging's job can't act
// in production's project.
//
// Three plain HTTPS calls rather than google-github-actions/auth: this runs
// after the Infisical injection, and no third-party action in the deploy job
// sees its environment (the image build's note in _deploy.yml says why). None
// of the three has a side effect, so each is retried like a read.

import { fetchWithRetry } from "./http.mjs";

const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const STS_URL = "https://sts.googleapis.com/v1/token";
const TOKEN_RETRY_METHODS = new Set(["GET", "POST"]);

/** The audience a provider accepts by default: its own resource URL. */
export function providerAudience(provider) {
  return `https://iam.googleapis.com/${provider}`;
}

async function readJson(response, what) {
  const text = await response.text();
  if (!response.ok) {
    // Google's error bodies name the refusal (an unmet condition, a missing
    // binding) and never echo a token, so they are safe to show.
    throw new Error(`${what} answered HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${what} answered HTTP ${response.status} with a body that isn't JSON.`);
  }
}

/** A GitHub OIDC token for `audience`. Needs the job's `id-token: write`. */
async function githubOidcToken({ audience, env = process.env, fetchImpl = fetch }) {
  const requestUrl = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!requestUrl || !requestToken) {
    throw new Error(
      "GitHub gave this job no OIDC token request URL. The job needs `permissions: id-token: write`, " +
        "and so does every workflow that calls it.",
    );
  }
  const url = new URL(requestUrl);
  url.searchParams.set("audience", audience);
  const response = await fetchWithRetry(
    url.toString(),
    { headers: { Authorization: `Bearer ${requestToken}`, Accept: "application/json" } },
    { fetchImpl },
  );
  const body = await readJson(response, "GitHub's OIDC token endpoint");
  if (typeof body.value !== "string" || !body.value) throw new Error("GitHub's OIDC token endpoint returned no token.");
  return body.value;
}

/** Google's federated token for a GitHub OIDC token, through `provider`. */
async function federatedToken({ oidcToken, provider, fetchImpl = fetch }) {
  const response = await fetchWithRetry(
    STS_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audience: `//iam.googleapis.com/${provider}`,
        grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
        requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
        scope: CLOUD_PLATFORM_SCOPE,
        subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
        subjectToken: oidcToken,
      }),
    },
    { fetchImpl, retryMethods: TOKEN_RETRY_METHODS },
  );
  const body = await readJson(response, "Google's token exchange");
  if (typeof body.access_token !== "string" || !body.access_token) {
    throw new Error("Google's token exchange returned no access token.");
  }
  return body.access_token;
}

/** A one-hour access token for `serviceAccount`, minted with a federated token. */
async function serviceAccountToken({ federated, serviceAccount, fetchImpl = fetch }) {
  const url =
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/` +
    `${encodeURIComponent(serviceAccount)}:generateAccessToken`;
  const response = await fetchWithRetry(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${federated}` },
      body: JSON.stringify({ scope: [CLOUD_PLATFORM_SCOPE], lifetime: "3600s" }),
    },
    { fetchImpl, retryMethods: TOKEN_RETRY_METHODS },
  );
  const body = await readJson(response, `Google's token service, for ${serviceAccount}`);
  if (typeof body.accessToken !== "string" || !body.accessToken) {
    throw new Error(`Google's token service returned no access token for ${serviceAccount}.`);
  }
  return body.accessToken;
}

/** The whole chain: an access token for `serviceAccount`, from this job's identity. */
export async function deployerAccessToken({ provider, serviceAccount, env = process.env, fetchImpl = fetch }) {
  const oidcToken = await githubOidcToken({ audience: providerAudience(provider), env, fetchImpl });
  const federated = await federatedToken({ oidcToken, provider, fetchImpl });
  return serviceAccountToken({ federated, serviceAccount, fetchImpl });
}
