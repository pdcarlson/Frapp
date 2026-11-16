import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyBootSecrets,
  BOOT_FETCH_RETRY_DELAYS_MS,
  DEFAULT_INFISICAL_API_URL,
  fetchBootSecrets,
  FRAPP_INFISICAL_PROJECT_ID,
  INFISICAL_BOOT_ENV,
  loadBootSecrets,
  planBootSecrets,
} from './infisical-boot-secrets';

const CLIENT_SECRET = 'not-a-real-client-secret';

const bootstrap = (overrides: Record<string, string | undefined> = {}) => ({
  [INFISICAL_BOOT_ENV.clientId]: 'client-id',
  [INFISICAL_BOOT_ENV.clientSecret]: CLIENT_SECRET,
  [INFISICAL_BOOT_ENV.environment]: 'staging',
  ...overrides,
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Call = { url: string; init?: RequestInit };

/** A fetch that answers login, then the secrets read, from the given queue. */
function fakeInfisical(
  responses: Array<(init?: RequestInit) => Response | Promise<Response>>,
) {
  const calls: Call[] = [];
  const fetchImpl = (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected call to ${url}`);
    return Promise.resolve(next(init));
  };
  return { calls, fetchImpl };
}

const LOGIN_OK = () => json(200, { accessToken: 'at-1', expiresIn: 7200 });

const SECRETS_OK = (secrets: Array<[string, string]>, imports = []) =>
  json(200, {
    secrets: secrets.map(([secretKey, secretValue]) => ({
      secretKey,
      secretValue,
    })),
    imports,
  });

describe('planBootSecrets', () => {
  it('skips when the service holds no Infisical identity', () => {
    expect(planBootSecrets({})).toEqual({ kind: 'skip' });
    expect(
      planBootSecrets({
        [INFISICAL_BOOT_ENV.clientId]: ' ',
        [INFISICAL_BOOT_ENV.clientSecret]: '',
        [INFISICAL_BOOT_ENV.environment]: ' ',
        // The sandbox's own Infisical names don't count.
        INFISICAL_PROJECT_ID: 'project',
        INFISICAL_MACHINE_IDENTITY_ID: 'id',
      }),
    ).toEqual({ kind: 'skip' });
  });

  it('refuses an environment set without the identity, rather than skipping', () => {
    expect(() =>
      planBootSecrets({ [INFISICAL_BOOT_ENV.environment]: 'staging' }),
    ).toThrow(
      /INFISICAL_UNIVERSAL_AUTH_CLIENT_ID, INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET not set/,
    );
  });

  it('defaults the project and the Infisical host', () => {
    expect(planBootSecrets(bootstrap())).toEqual({
      kind: 'fetch',
      clientId: 'client-id',
      clientSecret: CLIENT_SECRET,
      environment: 'staging',
      projectId: FRAPP_INFISICAL_PROJECT_ID,
      apiUrl: DEFAULT_INFISICAL_API_URL,
    });
  });

  it('keeps the project id equal to .infisical.json', () => {
    const config = JSON.parse(
      readFileSync(join(process.cwd(), '../../.infisical.json'), 'utf8'),
    ) as { workspaceId: string };
    expect(FRAPP_INFISICAL_PROJECT_ID).toBe(config.workspaceId);
  });

  it('refuses a partial bootstrap, naming what is missing, never a value', () => {
    expect(() =>
      planBootSecrets(bootstrap({ [INFISICAL_BOOT_ENV.clientSecret]: '' })),
    ).toThrow(/INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET not set/);
    expect(() =>
      planBootSecrets(bootstrap({ [INFISICAL_BOOT_ENV.environment]: '' })),
    ).toThrow(/INFISICAL_ENVIRONMENT not set/);
    try {
      planBootSecrets(bootstrap({ [INFISICAL_BOOT_ENV.clientId]: '' }));
      throw new Error('expected a throw');
    } catch (error) {
      expect(String(error)).not.toContain(CLIENT_SECRET);
    }
  });

  it("refuses 'production', which is not Infisical's slug", () => {
    expect(() =>
      planBootSecrets(
        bootstrap({ [INFISICAL_BOOT_ENV.environment]: 'production' }),
      ),
    ).toThrow(/production slug is 'prod'/);
    expect(
      planBootSecrets(bootstrap({ [INFISICAL_BOOT_ENV.environment]: 'prod' })),
    ).toMatchObject({ environment: 'prod' });
  });

  it('refuses to send the credential to a non-https host', () => {
    expect(() =>
      planBootSecrets(
        bootstrap({ [INFISICAL_BOOT_ENV.apiUrl]: 'http://infisical.local' }),
      ),
    ).toThrow(/must be an https URL/);
  });
});

describe('fetchBootSecrets', () => {
  const plan = planBootSecrets(bootstrap()) as Extract<
    ReturnType<typeof planBootSecrets>,
    { kind: 'fetch' }
  >;
  const noSleep = () => Promise.resolve();

  it('logs in, then reads path / of the environment with references resolved', async () => {
    const { calls, fetchImpl } = fakeInfisical([
      LOGIN_OK,
      () => SECRETS_OK([['SUPABASE_URL', 'https://example.supabase.co']]),
    ]);
    const secrets = await fetchBootSecrets(plan, { fetchImpl, sleep: noSleep });
    expect(secrets.get('SUPABASE_URL')).toBe('https://example.supabase.co');

    expect(calls[0].url).toBe(
      'https://app.infisical.com/api/v1/auth/universal-auth/login',
    );
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      clientId: 'client-id',
      clientSecret: CLIENT_SECRET,
    });
    const read = new URL(calls[1].url);
    expect(read.pathname).toBe('/api/v3/secrets/raw');
    expect(Object.fromEntries(read.searchParams)).toEqual({
      workspaceId: FRAPP_INFISICAL_PROJECT_ID,
      environment: 'staging',
      secretPath: '/',
      expandSecretReferences: 'true',
      include_imports: 'true',
    });
    expect(calls[1].init?.headers).toEqual({ Authorization: 'Bearer at-1' });
  });

  it("lets the environment's own value win over an imported one", async () => {
    const { fetchImpl } = fakeInfisical([
      LOGIN_OK,
      () =>
        SECRETS_OK([['SHARED', 'own']], [
          {
            secretPath: '/',
            environment: 'staging',
            secrets: [
              { secretKey: 'SHARED', secretValue: 'imported' },
              { secretKey: 'ONLY_IMPORTED', secretValue: 'x' },
            ],
          },
        ] as never),
    ]);
    const secrets = await fetchBootSecrets(plan, { fetchImpl, sleep: noSleep });
    expect(secrets.get('SHARED')).toBe('own');
    expect(secrets.get('ONLY_IMPORTED')).toBe('x');
  });

  it('retries a 5xx, a 429 and a network error, then succeeds', async () => {
    const waits: number[] = [];
    const { fetchImpl } = fakeInfisical([
      () => json(503, { message: 'down' }),
      LOGIN_OK,
      () => json(429, { message: 'slow down' }),
      () => {
        throw new TypeError('fetch failed');
      },
      LOGIN_OK,
      () => SECRETS_OK([['A', '1']]),
    ]);
    const secrets = await fetchBootSecrets(plan, {
      fetchImpl,
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    expect(secrets.get('A')).toBe('1');
    expect(waits).toEqual(BOOT_FETCH_RETRY_DELAYS_MS.slice(0, 3));
  });

  it('bounds each request with its timeout, and retries one that timed out', async () => {
    // Settles only when the request's own signal fires.
    const hang = (init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        const signal = init?.signal;
        if (!signal) throw new Error('the request carries no timeout');
        signal.addEventListener('abort', () => reject(signal.reason));
      });
    const { calls, fetchImpl } = fakeInfisical([
      hang,
      LOGIN_OK,
      hang,
      LOGIN_OK,
      () => SECRETS_OK([['A', '1']]),
    ]);
    const secrets = await fetchBootSecrets(plan, {
      fetchImpl,
      sleep: noSleep,
      timeoutMs: 20,
    });
    expect(secrets.get('A')).toBe('1');
    expect(calls).toHaveLength(5);
    for (const { init } of calls)
      expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('stops at once on a refused credential, without echoing the secret', async () => {
    const { calls, fetchImpl } = fakeInfisical([
      () => json(401, { message: `Invalid credentials for ${CLIENT_SECRET}` }),
    ]);
    const failure = fetchBootSecrets(plan, { fetchImpl, sleep: noSleep });
    await expect(failure).rejects.toThrow(
      /Universal Auth login answered HTTP 401: Invalid credentials for \[redacted\]/,
    );
    await expect(failure).rejects.not.toThrow(CLIENT_SECRET);
    expect(calls).toHaveLength(1);
  });

  it('gives up after the last retry, saying so', async () => {
    const attempts = BOOT_FETCH_RETRY_DELAYS_MS.length + 1;
    const { calls, fetchImpl } = fakeInfisical(
      Array.from({ length: attempts }, () => () => json(502, {})),
    );
    await expect(
      fetchBootSecrets(plan, { fetchImpl, sleep: noSleep }),
    ).rejects.toThrow(`gave up after ${attempts} attempts`);
    expect(calls).toHaveLength(attempts);
  });

  it('refuses a read that returns no list', async () => {
    const { fetchImpl } = fakeInfisical([LOGIN_OK, () => json(200, {})]);
    await expect(
      fetchBootSecrets(plan, { fetchImpl, sleep: noSleep }),
    ).rejects.toThrow(/returned no secrets list/);
  });
});

describe('applyBootSecrets', () => {
  it('lets Infisical replace platform values, but never INFISICAL_* or RENDER_*', () => {
    const env: NodeJS.Dict<string> = {
      ...bootstrap(),
      PORT: '10000',
      RENDER_GIT_COMMIT: 'abc1234',
    };
    const { applied, ignored } = applyBootSecrets(
      new Map([
        ['PORT', '3001'],
        ['SUPABASE_URL', 'https://example.supabase.co'],
        ['RENDER_GIT_COMMIT', 'deadbeef'],
        ['INFISICAL_ENVIRONMENT', 'prod'],
        ['not a name', 'x'],
      ]),
      env,
    );
    expect(applied).toEqual(['PORT', 'SUPABASE_URL']);
    expect(ignored).toEqual([
      'RENDER_GIT_COMMIT',
      'INFISICAL_ENVIRONMENT',
      'not a name',
    ]);
    expect(env.PORT).toBe('3001');
    expect(env.RENDER_GIT_COMMIT).toBe('abc1234');
    expect(env[INFISICAL_BOOT_ENV.environment]).toBe('staging');
  });

  it('drops the client secret from the env once used', () => {
    const env: NodeJS.Dict<string> = bootstrap();
    applyBootSecrets(new Map([['A', '1']]), env);
    expect(env[INFISICAL_BOOT_ENV.clientSecret]).toBeUndefined();
    expect(env[INFISICAL_BOOT_ENV.clientId]).toBe('client-id');
  });
});

describe('loadBootSecrets', () => {
  it('does nothing, and calls nothing, without the identity', async () => {
    const env: NodeJS.Dict<string> = { PORT: '3001' };
    const fetchImpl = jest.fn();
    await loadBootSecrets(env, { fetchImpl, log: () => {} });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(env).toEqual({ PORT: '3001' });
  });

  it('fills the env and logs a count, never a value', async () => {
    const env: NodeJS.Dict<string> = bootstrap();
    const lines: string[] = [];
    const { fetchImpl } = fakeInfisical([
      LOGIN_OK,
      () =>
        SECRETS_OK([
          ['SUPABASE_SERVICE_ROLE_KEY', 'srk-value'],
          ['RENDER_DEPLOY_HOOK_URL', 'https://hook'],
        ]),
    ]);
    await loadBootSecrets(env, {
      fetchImpl,
      sleep: () => Promise.resolve(),
      log: (line) => lines.push(line),
    });
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe('srk-value');
    expect(env.RENDER_DEPLOY_HOOK_URL).toBeUndefined();
    expect(lines).toEqual([
      "Loaded 1 secrets from Infisical environment 'staging'; ignored 1 reserved or malformed names: RENDER_DEPLOY_HOOK_URL.",
    ]);
    expect(lines.join('\n')).not.toMatch(/srk-value|https:\/\/hook/);
  });

  it('refuses an environment with nothing usable in it', async () => {
    const { fetchImpl } = fakeInfisical([LOGIN_OK, () => SECRETS_OK([])]);
    await expect(
      loadBootSecrets(bootstrap(), {
        fetchImpl,
        sleep: () => Promise.resolve(),
        log: () => {},
      }),
    ).rejects.toThrow(/returned no usable secrets/);
  });
});
