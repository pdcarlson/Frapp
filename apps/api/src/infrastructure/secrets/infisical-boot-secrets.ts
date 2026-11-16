/**
 * The API's runtime config, read from Infisical when the process starts.
 *
 * An image-backed Render service (#2506) holds no copy of the app's secrets.
 * It holds one read-only Infisical machine identity (Universal Auth), and
 * `boot.ts` calls this before anything else loads, so every module that reads
 * `process.env` at import time (Sentry first) sees the values. Owner decision
 * 2026-11-16: detach Render from Infisical so fewer places hold the values.
 * What each surface holds, and what this does not protect against:
 * docs/internal/environment/SECRETS_MANAGEMENT.md § Image-backed API: read at boot.
 *
 * Without the identity it does nothing: local runs (`infisical run` fills the
 * env), CI's image boot probe, and a git-backed Render service that the
 * Infisical sync still fills.
 *
 * Parity with that sync, on purpose: it reads the environment's path `/`,
 * resolves references, and an Infisical value replaces whatever the platform
 * set under the same name (the sync overwrote Render's own `PORT`, for one).
 * Two families are never taken from Infisical: `INFISICAL_*`, the bootstrap's
 * own names, and `RENDER_*`, which the platform owns.
 *
 * It fails closed. A partial bootstrap, a refused credential, or an
 * environment that returns nothing stops the process before Nest loads,
 * because an API that boots on half its config fails later, and less clearly.
 * A network error, a timeout, a 429 or a 5xx is retried for about a minute,
 * which is the window an Infisical blip costs a start. No message ever
 * carries a value.
 */

import { toReportableError } from '../observability/reportable-error';

/** The bootstrap's env names. The client pair is the Infisical CLI's own naming. */
export const INFISICAL_BOOT_ENV = {
  clientId: 'INFISICAL_UNIVERSAL_AUTH_CLIENT_ID',
  clientSecret: 'INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET',
  environment: 'INFISICAL_ENVIRONMENT',
  projectId: 'INFISICAL_PROJECT_ID',
  apiUrl: 'INFISICAL_API_URL',
} as const;

export const DEFAULT_INFISICAL_API_URL = 'https://app.infisical.com';

/**
 * The Frapp Infisical project: `.infisical.json`'s `workspaceId`, which a spec
 * keeps equal. Not a secret; it grants nothing without a credential.
 */
export const FRAPP_INFISICAL_PROJECT_ID =
  'a207b6c2-0be2-4507-a8fb-9a21ee8538bd';

/**
 * Environment SLUGS a deployed API reads. Production's slug is `prod`, not
 * `production` (the trap `scripts/check-env-slugs.mjs` exists for), so any
 * other value is refused rather than read as an empty environment.
 */
export const INFISICAL_BOOT_ENVIRONMENTS = ['staging', 'prod'] as const;

/** Never taken from Infisical: the bootstrap's own names and the platform's. */
export const RESERVED_ENV_PREFIXES = ['INFISICAL_', 'RENDER_'] as const;

/** Attempts per start, and the waits between them (about a minute in all). */
export const BOOT_FETCH_RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 15_000, 30_000];
export const BOOT_FETCH_TIMEOUT_MS = 10_000;

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type BootSecretsPlan =
  | { kind: 'skip' }
  | {
      kind: 'fetch';
      clientId: string;
      clientSecret: string;
      environment: string;
      projectId: string;
      apiUrl: string;
    };

type Env = NodeJS.Dict<string | undefined>;

function read(env: Env, name: string): string {
  return (env[name] ?? '').trim();
}

/**
 * Whether this start reads Infisical, from the bootstrap names alone. Throws
 * on a partial bootstrap, naming what is missing.
 */
export function planBootSecrets(env: Env): BootSecretsPlan {
  const clientId = read(env, INFISICAL_BOOT_ENV.clientId);
  const clientSecret = read(env, INFISICAL_BOOT_ENV.clientSecret);
  const environment = read(env, INFISICAL_BOOT_ENV.environment);
  // Any one of the three means the service was meant to read Infisical, so
  // the rest missing (a misspelt name, say) is refused, never skipped.
  if (!clientId && !clientSecret && !environment) return { kind: 'skip' };

  const missing: string[] = [];
  if (!clientId) missing.push(INFISICAL_BOOT_ENV.clientId);
  if (!clientSecret) missing.push(INFISICAL_BOOT_ENV.clientSecret);
  if (!environment) missing.push(INFISICAL_BOOT_ENV.environment);
  if (missing.length > 0) {
    throw new Error(
      `the Infisical bootstrap is incomplete: ${missing.join(', ')} not set. ` +
        `Set all of ${INFISICAL_BOOT_ENV.clientId}, ${INFISICAL_BOOT_ENV.clientSecret} ` +
        `and ${INFISICAL_BOOT_ENV.environment} on the service, or none of them.`,
    );
  }
  if (
    !(INFISICAL_BOOT_ENVIRONMENTS as readonly string[]).includes(environment)
  ) {
    throw new Error(
      `${INFISICAL_BOOT_ENV.environment}='${environment}' is not one of ` +
        `${INFISICAL_BOOT_ENVIRONMENTS.join(', ')} (Infisical's production slug is 'prod').`,
    );
  }

  const apiUrl = (
    read(env, INFISICAL_BOOT_ENV.apiUrl) || DEFAULT_INFISICAL_API_URL
  ).replace(/\/+$/, '');
  if (!/^https:\/\//.test(apiUrl)) {
    throw new Error(
      `${INFISICAL_BOOT_ENV.apiUrl} must be an https URL; refusing to send a credential elsewhere.`,
    );
  }
  return {
    kind: 'fetch',
    clientId,
    clientSecret,
    environment,
    projectId:
      read(env, INFISICAL_BOOT_ENV.projectId) || FRAPP_INFISICAL_PROJECT_ID,
    apiUrl,
  };
}

/** A failure re-asking can't fix (a refused credential, a wrong project). */
class PermanentBootSecretsError extends Error {}

const RETRYABLE_STATUS = (status: number) => status === 429 || status >= 500;

function redact(text: string, secret: string): string {
  return secret ? text.split(secret).join('[redacted]') : text;
}

async function readFailure(
  response: Response,
  what: string,
  secret: string,
): Promise<Error> {
  let detail = '';
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body?.message === 'string') {
      detail = `: ${redact(body.message, secret).slice(0, 200)}`;
    }
  } catch {
    // caught-failure-exempt: the body is only a hint; the status alone names the failure
  }
  const message = `${what} answered HTTP ${response.status}${detail}`;
  return RETRYABLE_STATUS(response.status)
    ? new Error(message)
    : new PermanentBootSecretsError(message);
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

type RawSecret = { secretKey?: unknown; secretValue?: unknown };

function collect(into: Map<string, string>, list: unknown): void {
  if (!Array.isArray(list)) return;
  for (const entry of list as RawSecret[]) {
    if (
      typeof entry?.secretKey === 'string' &&
      typeof entry.secretValue === 'string'
    ) {
      into.set(entry.secretKey, entry.secretValue);
    }
  }
}

async function fetchOnce(
  plan: Extract<BootSecretsPlan, { kind: 'fetch' }>,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<Map<string, string>> {
  const login = await fetchImpl(
    `${plan.apiUrl}/api/v1/auth/universal-auth/login`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: plan.clientId,
        clientSecret: plan.clientSecret,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
  if (!login.ok) {
    throw await readFailure(
      login,
      'Infisical Universal Auth login',
      plan.clientSecret,
    );
  }
  const { accessToken } = (await login.json()) as { accessToken?: unknown };
  if (typeof accessToken !== 'string' || !accessToken) {
    throw new PermanentBootSecretsError(
      'Infisical Universal Auth login returned no access token',
    );
  }

  const query = new URLSearchParams({
    workspaceId: plan.projectId,
    environment: plan.environment,
    secretPath: '/',
    expandSecretReferences: 'true',
    include_imports: 'true',
  });
  const listed = await fetchImpl(
    `${plan.apiUrl}/api/v3/secrets/raw?${query.toString()}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
  if (!listed.ok) {
    throw await readFailure(
      listed,
      `Infisical secrets read (environment '${plan.environment}')`,
      plan.clientSecret,
    );
  }
  const body = (await listed.json()) as {
    secrets?: unknown;
    imports?: Array<{ secrets?: unknown }>;
  };
  if (!Array.isArray(body?.secrets)) {
    throw new PermanentBootSecretsError(
      `Infisical secrets read (environment '${plan.environment}') returned no secrets list`,
    );
  }
  // Imported secrets first, so the environment's own value wins, as in Infisical.
  const secrets = new Map<string, string>();
  for (const imported of Array.isArray(body.imports) ? body.imports : []) {
    collect(secrets, imported?.secrets);
  }
  collect(secrets, body.secrets);
  return secrets;
}

export type FetchBootSecretsOptions = {
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  retryDelaysMs?: readonly number[];
  timeoutMs?: number;
};

/** Login, then read the environment, re-asking on what a retry can fix. */
export async function fetchBootSecrets(
  plan: Extract<BootSecretsPlan, { kind: 'fetch' }>,
  {
    fetchImpl = fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log = () => {},
    retryDelaysMs = BOOT_FETCH_RETRY_DELAYS_MS,
    timeoutMs = BOOT_FETCH_TIMEOUT_MS,
  }: FetchBootSecretsOptions = {},
): Promise<Map<string, string>> {
  const attempts = retryDelaysMs.length + 1;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetchOnce(plan, fetchImpl, timeoutMs);
    } catch (error) {
      const message = redact(
        toReportableError(error).message,
        plan.clientSecret,
      );
      if (error instanceof PermanentBootSecretsError || attempt >= attempts) {
        throw new Error(
          attempt >= attempts && !(error instanceof PermanentBootSecretsError)
            ? `${message} (gave up after ${attempts} attempts)`
            : message,
        );
      }
      const wait = retryDelaysMs[attempt - 1];
      log(
        `Infisical read failed (${message}); attempt ${attempt} of ${attempts}, retrying in ${wait / 1000}s.`,
      );
      await sleep(wait);
    }
  }
}

function isReserved(name: string): boolean {
  return RESERVED_ENV_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/**
 * Write the secrets into `env` and drop the client secret from it, so nothing
 * the app logs or reports can carry it. Returns the names it set and the
 * names it refused, never a value.
 */
export function applyBootSecrets(
  secrets: Map<string, string>,
  env: Env,
): { applied: string[]; ignored: string[] } {
  const applied: string[] = [];
  const ignored: string[] = [];
  for (const [name, value] of secrets) {
    if (!ENV_NAME_PATTERN.test(name) || isReserved(name)) {
      ignored.push(name);
      continue;
    }
    env[name] = value;
    applied.push(name);
  }
  delete env[INFISICAL_BOOT_ENV.clientSecret];
  return { applied, ignored };
}

/**
 * The whole step `boot.ts` runs. Resolves when the env is filled or there is
 * nothing to do; rejects, with a value-free message, when the API must not
 * start.
 */
export async function loadBootSecrets(
  env: Env = process.env,
  options: FetchBootSecretsOptions = {},
): Promise<void> {
  const log = options.log ?? ((line: string) => console.log(line));
  const plan = planBootSecrets(env);
  if (plan.kind === 'skip') return;

  const secrets = await fetchBootSecrets(plan, { ...options, log });
  const { applied, ignored } = applyBootSecrets(secrets, env);
  if (applied.length === 0) {
    throw new Error(
      `Infisical environment '${plan.environment}' returned no usable secrets; ` +
        `check that the machine identity can read it at path '/'.`,
    );
  }
  log(
    `Loaded ${applied.length} secrets from Infisical environment '${plan.environment}'` +
      (ignored.length > 0
        ? `; ignored ${ignored.length} reserved or malformed names: ${ignored.join(', ')}`
        : '') +
      '.',
  );
}
