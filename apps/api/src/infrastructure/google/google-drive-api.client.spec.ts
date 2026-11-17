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
const ACCOUNT = {
  clientEmail: 'frapp-docs@signet-frapp.iam.gserviceaccount.com',
  privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
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

  // #5434: what a file link is judged by, asked for and read.
  it('reads who can open an item, whether it is trashed, and its resource key', async () => {
    const client = new GoogleDriveApiClient(ACCOUNT);
    withToken();
    fetchMock.mockResolvedValueOnce(
      json(200, {
        id: 'f',
        name: 'Bylaws',
        mimeType: 'application/vnd.google-apps.document',
        permissionIds: ['anyoneWithLink', '0123'],
        trashed: true,
        resourceKey: '0-key',
      }),
    );

    const item = await client.getItem('f', '0-key');

    expect(item).toMatchObject({
      permissionIds: ['anyoneWithLink', '0123'],
      trashed: true,
      resourceKey: '0-key',
    });
    const [url, init] = fetchMock.mock.calls[1];
    expect(new URL(String(url)).searchParams.get('fields')).toContain(
      'permissionIds,trashed,resourceKey',
    );
    expect(init.headers['X-Goog-Drive-Resource-Keys']).toBe('f/0-key');
    expect(init.headers.Authorization).toBe('Bearer token-1');
  });

  it('sends the resource key on a download and an export, and no header without one', async () => {
    const client = new GoogleDriveApiClient(ACCOUNT);
    withToken();
    fetchMock
      .mockResolvedValueOnce(new Response(new Uint8Array([1])))
      .mockResolvedValueOnce(new Response(new Uint8Array([2])))
      .mockResolvedValueOnce(new Response(new Uint8Array([3])));

    await client.download('f', 10, '0-key');
    await client.exportAs('g', 'application/pdf', 10, '0-key');
    await client.download('h', 10);

    expect(
      fetchMock.mock.calls[1][1].headers['X-Goog-Drive-Resource-Keys'],
    ).toBe('f/0-key');
    expect(
      fetchMock.mock.calls[2][1].headers['X-Goog-Drive-Resource-Keys'],
    ).toBe('g/0-key');
    expect(fetchMock.mock.calls[3][1].headers).not.toHaveProperty(
      'X-Goog-Drive-Resource-Keys',
    );
  });

  // #5185: a code only this server can make, the same each time for one
  // chapter and folder, different for another, and none without a key.
  it('makes a stable connect code keyed by the account’s own key', () => {
    const client = new GoogleDriveApiClient(ACCOUNT);
    const code = client.proofCode('ch-1:folder');
    expect(code).toMatch(/^frapp-[0-9a-hjkmnp-tv-z]{8}$/);
    expect(client.proofCode('ch-1:folder')).toBe(code);
    expect(client.proofCode('ch-2:folder')).not.toBe(code);
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    expect(
      new GoogleDriveApiClient({ ...ACCOUNT, privateKey: other }).proofCode(
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
