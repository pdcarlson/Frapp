import { createVerify, generateKeyPairSync } from 'node:crypto';
import { GoogleDriveApiError } from '#domain/adapters/google-drive.interface';
import { GoogleDriveApiClient, signJwt } from './google-drive-api.client';
import {
  googleDriveServiceAccount,
  validateGoogleDriveEnv,
} from '../../config/google-drive-config';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const ACCOUNT = {
  clientEmail: 'frapp-docs@signet-frapp.iam.gserviceaccount.com',
  privateKey: PEM,
  proofSecret: PEM,
};
/** The keyless account (#5434): acts as the Drive account from Cloud Run. */
const KEYLESS = {
  clientEmail: 'frapp-docs@cs-project-6vw9f5xp.iam.gserviceaccount.com',
  privateKey: null,
  proofSecret: 'p'.repeat(64),
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('GoogleDriveApiClient', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  const withToken = () =>
    fetchMock.mockResolvedValueOnce(
      json(200, { access_token: 'token-1', expires_in: 3600 }),
    );

  it('signs an RS256 assertion Google can verify with the account’s key', () => {
    const jwt = signJwt(ACCOUNT, { iss: ACCOUNT.clientEmail, aud: 'x' });
    const [header, payload, signature] = jwt.split('.');
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${payload}`);
    expect(verifier.verify(publicKey, signature, 'base64url')).toBe(true);
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    });
  });

  it('trades an assertion for one token, reused across calls', async () => {
    const client = new GoogleDriveApiClient(ACCOUNT);
    withToken();
    fetchMock.mockResolvedValueOnce(
      json(200, {
        id: 'f',
        name: 'Folder',
        mimeType: 'application/vnd.google-apps.folder',
      }),
    );
    fetchMock.mockResolvedValueOnce(json(200, { files: [] }));

    await client.getItem('f');
    await client.listChildren('f');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const tokenBody = String(fetchMock.mock.calls[0][1].body);
    expect(tokenBody).toContain(
      'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer',
    );
    expect(fetchMock.mock.calls[2][1].headers).toEqual({
      Authorization: 'Bearer token-1',
    });
  });

  it('reads one item with its Description and parents', async () => {
    const client = new GoogleDriveApiClient(ACCOUNT);
    withToken();
    fetchMock.mockResolvedValueOnce(
      json(200, {
        id: 'f',
        name: 'Folder',
        mimeType: 'application/vnd.google-apps.folder',
        description: 'frapp-k3x9qm2p',
        parents: ['p1'],
      }),
    );

    const item = await client.getItem('f');

    expect(item).toMatchObject({
      description: 'frapp-k3x9qm2p',
      parents: ['p1'],
    });
    expect(
      new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('fields'),
    ).toContain('description,parents');
  });

  // #5185: a code only this server can make, the same each time for one
  // chapter and folder, different for another, and none without a key.
  it('makes a stable connect code keyed by the account’s proof secret', () => {
    const client = new GoogleDriveApiClient(ACCOUNT);
    const code = client.proofCode('ch-1:folder');
    expect(code).toMatch(/^frapp-[0-9a-hjkmnp-tv-z]{8}$/);
    expect(client.proofCode('ch-1:folder')).toBe(code);
    expect(client.proofCode('ch-2:folder')).not.toBe(code);
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    expect(
      new GoogleDriveApiClient({ ...ACCOUNT, proofSecret: other }).proofCode(
        'ch-1:folder',
      ),
    ).not.toBe(code);
    expect(new GoogleDriveApiClient(null).proofCode('ch-1:folder')).toBeNull();
  });

  it('reads every page of a folder, sizes as numbers', async () => {
    const client = new GoogleDriveApiClient(ACCOUNT);
    withToken();
    fetchMock.mockResolvedValueOnce(
      json(200, {
        files: [
          { id: 'a', name: 'A.pdf', mimeType: 'application/pdf', size: '12' },
        ],
        nextPageToken: 'p2',
      }),
    );
    fetchMock.mockResolvedValueOnce(
      json(200, {
        files: [
          {
            id: 'b',
            name: 'B',
            mimeType: 'application/vnd.google-apps.document',
          },
        ],
      }),
    );

    const items = await client.listChildren('folder_1');

    expect(items.map((i) => [i.id, i.size])).toEqual([
      ['a', 12],
      ['b', null],
    ]);
    expect(String(fetchMock.mock.calls[2][0])).toContain('pageToken=p2');
    expect(
      new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('q'),
    ).toContain("'folder_1' in parents and trashed = false");
  });

  it('refuses a folder id that could change the query', async () => {
    const client = new GoogleDriveApiClient(ACCOUNT);
    await expect(client.listChildren("x' or '1'='1")).rejects.toThrow(
      GoogleDriveApiError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [404, { error: { errors: [{ reason: 'notFound' }] } }, 'not_found'],
    [
      403,
      { error: { errors: [{ reason: 'insufficientFilePermissions' }] } },
      'forbidden',
    ],
    [
      403,
      { error: { errors: [{ reason: 'userRateLimitExceeded' }] } },
      'rate_limited',
    ],
    [429, {}, 'rate_limited'],
    [
      403,
      { error: { errors: [{ reason: 'exportSizeLimitExceeded' }] } },
      'too_large',
    ],
    [403, { error: { errors: [{ reason: 'accessNotConfigured' }] } }, 'failed'],
    [500, {}, 'failed'],
  ])('maps a %i with %j to %s', async (status, body, kind) => {
    const client = new GoogleDriveApiClient(ACCOUNT);
    withToken();
    fetchMock.mockResolvedValueOnce(json(status, body));

    await expect(client.getItem('f')).rejects.toMatchObject({ kind });
  });

  it('stops a download past the limit', async () => {
    const client = new GoogleDriveApiClient(ACCOUNT);
    withToken();
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array(20)));

    await expect(client.download('f', 10)).rejects.toMatchObject({
      kind: 'too_large',
    });
  });

  it('returns a download’s bytes within the limit', async () => {
    const client = new GoogleDriveApiClient(ACCOUNT);
    withToken();
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));

    await expect(client.download('f', 10)).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it('without a key file, trades the runtime identity’s token for one acting as the Drive account', async () => {
    const client = new GoogleDriveApiClient(KEYLESS);
    fetchMock
      .mockResolvedValueOnce(
        json(200, { access_token: 'runtime-token', expires_in: 3599 }),
      )
      .mockResolvedValueOnce(
        json(200, {
          accessToken: 'drive-token',
          expireTime: new Date(Date.now() + 3600_000).toISOString(),
        }),
      )
      .mockResolvedValueOnce(json(200, { id: 'f', name: 'F', mimeType: 'x' }))
      .mockResolvedValueOnce(json(200, { id: 'g', name: 'G', mimeType: 'x' }));

    await client.getItem('f');
    await client.getItem('g');

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const [metadataUrl, metadataInit] = fetchMock.mock.calls[0];
    expect(metadataUrl).toBe(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    );
    expect(metadataInit.headers).toEqual({ 'Metadata-Flavor': 'Google' });
    const [iamUrl, iamInit] = fetchMock.mock.calls[1];
    expect(iamUrl).toBe(
      'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/frapp-docs%40cs-project-6vw9f5xp.iam.gserviceaccount.com:generateAccessToken',
    );
    expect(iamInit.headers.Authorization).toBe('Bearer runtime-token');
    expect(JSON.parse(iamInit.body)).toEqual({
      scope: ['https://www.googleapis.com/auth/drive.readonly'],
      lifetime: '3600s',
    });
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe(
      'Bearer drive-token',
    );
    expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe(
      'Bearer drive-token',
    );
  });

  it('reports a refused act-as as a setup fault, not a file Frapp can’t see', async () => {
    const client = new GoogleDriveApiClient(KEYLESS);
    fetchMock
      .mockResolvedValueOnce(json(200, { access_token: 'runtime-token' }))
      .mockResolvedValueOnce(
        // IAM Credentials' own error shape: `status`, no `errors` list.
        json(403, {
          error: {
            code: 403,
            message: 'Permission iam.serviceAccounts.getAccessToken denied',
            status: 'PERMISSION_DENIED',
          },
        }),
      );

    await expect(client.getItem('f')).rejects.toMatchObject({
      kind: 'failed',
      status: 403,
      reason: 'act_as_PERMISSION_DENIED',
    });
  });

  it('names a missing runtime token, so the logs point at the platform, not Drive', async () => {
    const client = new GoogleDriveApiClient(KEYLESS);
    fetchMock.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

    await expect(client.getItem('f')).rejects.toMatchObject({
      kind: 'failed',
      status: 404,
      reason: 'no_runtime_token',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps a quota on acting as the account a rate limit, so the sync backs off', async () => {
    const client = new GoogleDriveApiClient(KEYLESS);
    fetchMock
      .mockResolvedValueOnce(json(200, { access_token: 'runtime-token' }))
      .mockResolvedValueOnce(
        json(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }),
      );

    await expect(client.getItem('f')).rejects.toMatchObject({
      kind: 'rate_limited',
      reason: 'act_as_RESOURCE_EXHAUSTED',
    });
  });

  it('keys connect codes with the proof secret, not the key', () => {
    const keyless = new GoogleDriveApiClient(KEYLESS);
    const other = new GoogleDriveApiClient({
      ...KEYLESS,
      proofSecret: 'q'.repeat(64),
    });
    const code = keyless.proofCode('chapter:folder');
    expect(code).toMatch(/^frapp-[0-9a-z]{8}$/);
    expect(keyless.proofCode('chapter:folder')).toBe(code);
    expect(other.proofCode('chapter:folder')).not.toBe(code);
  });

  it('is off without a key', () => {
    const client = new GoogleDriveApiClient(null);
    expect(client.isConfigured()).toBe(false);
    expect(client.serviceAccountEmail()).toBeNull();
  });
});

describe('google-drive-config', () => {
  const keyFile = JSON.stringify({
    type: 'service_account',
    client_email: ACCOUNT.clientEmail,
    private_key: ACCOUNT.privateKey,
  });

  it('reads a service account key file', () => {
    expect(
      googleDriveServiceAccount({ GOOGLE_DRIVE_CREDENTIALS_JSON: keyFile }),
    ).toEqual(ACCOUNT);
    expect(googleDriveServiceAccount({})).toBeNull();
  });

  const keyless = {
    GOOGLE_DRIVE_SERVICE_ACCOUNT: KEYLESS.clientEmail,
    GOOGLE_DRIVE_PROOF_SECRET: KEYLESS.proofSecret,
  };

  it('acts as the named account without a key file on Cloud Run only', () => {
    expect(
      googleDriveServiceAccount({ ...keyless, K_SERVICE: 'frapp-api' }),
    ).toEqual(KEYLESS);
    expect(googleDriveServiceAccount(keyless)).toBeNull();
    expect(
      googleDriveServiceAccount({
        GOOGLE_DRIVE_SERVICE_ACCOUNT: KEYLESS.clientEmail,
        K_SERVICE: 'frapp-api',
      }),
    ).toBeNull();
  });

  const onCloudRun = { ...keyless, K_SERVICE: 'frapp-api' };

  it('checks the keyless settings at boot', () => {
    expect(validateGoogleDriveEnv(onCloudRun)).toEqual([]);
    expect(
      validateGoogleDriveEnv({
        GOOGLE_DRIVE_SERVICE_ACCOUNT: KEYLESS.clientEmail,
        K_SERVICE: 'frapp-api',
      }),
    ).toEqual([expect.stringContaining('needs GOOGLE_DRIVE_PROOF_SECRET')]);
    expect(
      validateGoogleDriveEnv({
        ...onCloudRun,
        GOOGLE_DRIVE_SERVICE_ACCOUNT: 'me@gmail.com',
      }),
    ).toEqual([expect.stringContaining('must be a service account address')]);
    expect(
      validateGoogleDriveEnv({
        ...onCloudRun,
        GOOGLE_DRIVE_PROOF_SECRET: 'short',
      }),
    ).toEqual([expect.stringContaining('at least 32 characters')]);
    expect(
      validateGoogleDriveEnv({
        ...onCloudRun,
        GOOGLE_DRIVE_CREDENTIALS_JSON: keyFile,
      }),
    ).toEqual([expect.stringContaining('not both')]);
  });

  it('fails boot on the keyless pair off Cloud Run, as Vertex AI does', () => {
    expect(validateGoogleDriveEnv(onCloudRun)).toEqual([]);
    expect(validateGoogleDriveEnv(keyless)).toEqual([
      expect.stringContaining('Only Cloud Run'),
    ]);
  });

  it('never keys codes with an empty private key', () => {
    const empty = JSON.stringify({
      type: 'service_account',
      client_email: ACCOUNT.clientEmail,
      private_key: '',
    });
    expect(
      googleDriveServiceAccount({ GOOGLE_DRIVE_CREDENTIALS_JSON: empty }),
    ).toBeNull();
    expect(
      validateGoogleDriveEnv({ GOOGLE_DRIVE_CREDENTIALS_JSON: empty }),
    ).toEqual([expect.stringContaining('must be a service account key file')]);
  });

  it('fails boot on anything that isn’t one, without echoing it', () => {
    const problems = validateGoogleDriveEnv({
      GOOGLE_DRIVE_CREDENTIALS_JSON: '{"secret":"value"}',
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).not.toContain('value');
    expect(validateGoogleDriveEnv({})).toEqual([]);
    expect(
      validateGoogleDriveEnv({ GOOGLE_DRIVE_CREDENTIALS_JSON: keyFile }),
    ).toEqual([]);
  });
});
