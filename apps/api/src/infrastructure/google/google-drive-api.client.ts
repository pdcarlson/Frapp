import { createHmac, createSign } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  googleDriveServiceAccount,
  type GoogleDriveServiceAccount,
} from '../../config/google-drive-config';
import {
  GoogleDriveApiError,
  type GoogleDriveItem,
  type IGoogleDriveApi,
} from '#domain/adapters/google-drive.interface';
import { CROCKFORD } from '#domain/utils/check-in-token';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** What a member's own access token is for (#5583). */
const TOKEN_INFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
/** The runtime identity's own token, from Cloud Run's metadata server. */
const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
const IAM_CREDENTIALS_API = 'https://iamcredentials.googleapis.com/v1';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
/** A metadata call gives up after this long. */
const TIMEOUT_MS = 10_000;
/** A download or export gives up after this long (25 MB on a slow link). */
const TRANSFER_TIMEOUT_MS = 90_000;
/** Google's own page size cap for files.list. */
const LIST_PAGE_SIZE = 1000;
/** Pages read at most per folder. */
const LIST_MAX_PAGES = 10;
/** A token is renewed this long before Google says it expires. */
const TOKEN_MARGIN_MS = 5 * 60 * 1000;
const ITEM_FIELDS = 'id,name,mimeType,modifiedTime,size,webViewLink';
/** One item read on its own also brings what the connect check reads. */
const GET_ITEM_FIELDS = `${ITEM_FIELDS},description,parents,permissionIds,trashed,resourceKey`;
/** 8 characters, 40 bits. */
const CODE_LENGTH = 8;
const CONFIG_REASONS = new Set(['accessNotConfigured', 'SERVICE_DISABLED']);
const RATE_LIMIT_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'quotaExceeded',
  'dailyLimitExceeded',
]);

/**
 * Google Drive for what chapters share with Frapp (#5157), over `fetch`. No
 * Google SDK, as with `GoogleCalendarApiClient`: these are a few plain calls.
 *
 * Signs in as the Drive service account (`config/google-drive-config.ts`):
 * with its key file, a signed assertion; without one, on Cloud Run (#5434),
 * the runtime identity's token from the metadata server, traded at IAM
 * Credentials for a token that acts as the Drive account.
 * Errors carry Google's short reason and status, never a token or a body.
 */
@Injectable()
export class GoogleDriveApiClient implements IGoogleDriveApi {
  private readonly account: GoogleDriveServiceAccount | null;
  private token: { value: string; expiresAt: number } | null = null;
  private pendingToken: Promise<string> | null = null;

  constructor(account?: GoogleDriveServiceAccount | null) {
    this.account =
      account === undefined ? googleDriveServiceAccount() : account;
  }

  isConfigured(): boolean {
    return this.account !== null;
  }

  serviceAccountEmail(): string | null {
    return this.account?.clientEmail ?? null;
  }

  proofCode(subject: string): string | null {
    if (!this.account) return null;
    const digest = createHmac('sha256', this.account.proofSecret)
      .update(`frapp-drive-connect:${subject}`)
      .digest();
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i += 1) {
      // Crockford base32 (no I, L, O or U), as check-in codes use, so a
      // code typed by hand matches through the same substitutions.
      code += CROCKFORD[digest[i] % CROCKFORD.length];
    }
    return `frapp-${code.toLowerCase()}`;
  }

  async getItem(
    id: string,
    resourceKey?: string | null,
  ): Promise<GoogleDriveItem> {
    const body = await this.json(
      `/files/${encodeURIComponent(id)}?${new URLSearchParams({
        fields: GET_ITEM_FIELDS,
        supportsAllDrives: 'true',
      }).toString()}`,
      resourceKeyHeader(id, resourceKey),
    );
    return toItem(body);
  }

  async listChildren(folderId: string): Promise<GoogleDriveItem[]> {
    if (!/^[A-Za-z0-9_-]+$/.test(folderId)) {
      throw new GoogleDriveApiError('not_found', null, 'bad_folder_id');
    }
    const items: GoogleDriveItem[] = [];
    let pageToken: string | null = null;
    for (let page = 0; page < LIST_MAX_PAGES; page += 1) {
      const query = new URLSearchParams({
        q: `'${folderId}' in parents and trashed = false`,
        fields: `nextPageToken,files(${ITEM_FIELDS})`,
        pageSize: String(LIST_PAGE_SIZE),
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
        orderBy: 'name',
      });
      if (pageToken) query.set('pageToken', pageToken);
      const body = await this.json(`/files?${query.toString()}`);
      const files = (body as { files?: unknown[] }).files ?? [];
      for (const file of files) items.push(toItem(file));
      const next = (body as { nextPageToken?: unknown }).nextPageToken;
      if (typeof next !== 'string' || next === '') break;
      pageToken = next;
    }
    return items;
  }

  async download(
    fileId: string,
    maxBytes: number,
    resourceKey?: string | null,
  ): Promise<Uint8Array> {
    return this.bytes(
      `/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
      maxBytes,
      resourceKeyHeader(fileId, resourceKey),
    );
  }

  async exportAs(
    fileId: string,
    mimeType: string,
    maxBytes: number,
    resourceKey?: string | null,
  ): Promise<Uint8Array> {
    return this.bytes(
      `/files/${encodeURIComponent(fileId)}/export?${new URLSearchParams({
        mimeType,
      }).toString()}`,
      maxBytes,
      resourceKeyHeader(fileId, resourceKey),
    );
  }

  async userTokenInfo(
    accessToken: string,
  ): Promise<{ clientId: string; scopes: string[] } | null> {
    // POSTed, so the token is never in a URL a proxy or log could keep.
    const response = await this.send(
      TOKEN_INFO_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ access_token: accessToken }).toString(),
      },
      TIMEOUT_MS,
    );
    // Google answers 400 for a token that is expired, revoked or made up.
    if (response.status === 400) return null;
    if (!response.ok) throw await apiError(response);
    const body = (await response.json()) as Record<string, unknown>;
    const clientId =
      typeof body.azp === 'string'
        ? body.azp
        : typeof body.aud === 'string'
          ? body.aud
          : null;
    if (!clientId) return null;
    const scopes =
      typeof body.scope === 'string'
        ? body.scope.split(' ').filter(Boolean)
        : [];
    return { clientId, scopes };
  }

  async getItemAs(accessToken: string, id: string): Promise<GoogleDriveItem> {
    const body = await this.json(
      `/files/${encodeURIComponent(id)}?${new URLSearchParams({
        fields: `${GET_ITEM_FIELDS},capabilities/canEdit`,
        supportsAllDrives: 'true',
      }).toString()}`,
      {},
      { token: accessToken },
    );
    return toItem(body);
  }

  async shareWithServiceAccount(
    accessToken: string,
    id: string,
  ): Promise<string> {
    const email = this.serviceAccountEmail();
    if (!email) throw new GoogleDriveApiError('failed', null, 'unconfigured');
    const body = await this.json(
      `/files/${encodeURIComponent(id)}/permissions?${new URLSearchParams({
        sendNotificationEmail: 'false',
        supportsAllDrives: 'true',
        fields: 'id',
      }).toString()}`,
      { 'Content-Type': 'application/json' },
      {
        token: accessToken,
        method: 'POST',
        body: JSON.stringify({
          type: 'user',
          role: 'reader',
          emailAddress: email,
        }),
      },
    );
    const permissionId = (body as { id?: unknown }).id;
    if (typeof permissionId !== 'string' || permissionId === '') {
      throw new GoogleDriveApiError('failed', null, 'no_permission_id');
    }
    return permissionId;
  }

  async unshare(
    accessToken: string,
    id: string,
    permissionId: string,
  ): Promise<void> {
    const response = await this.send(
      `${DRIVE_API}/files/${encodeURIComponent(id)}/permissions/${encodeURIComponent(permissionId)}?supportsAllDrives=true`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      TIMEOUT_MS,
    );
    if (!response.ok) throw await apiError(response);
  }

  /**
   * One Drive call that answers JSON: as the service account, or with
   * `as.token`, as the member whose own sign-in it is (#5583).
   */
  private async json(
    path: string,
    extra: Record<string, string> = {},
    as: { token?: string; method?: string; body?: string } = {},
  ): Promise<unknown> {
    const response = await this.send(
      `${DRIVE_API}${path}`,
      {
        method: as.method ?? 'GET',
        headers: {
          ...extra,
          Authorization: `Bearer ${as.token ?? (await this.accessToken())}`,
        },
        ...(as.body !== undefined ? { body: as.body } : {}),
      },
      TIMEOUT_MS,
    );
    if (!response.ok) throw await apiError(response);
    return response.json();
  }

  private async bytes(
    path: string,
    maxBytes: number,
    extra: Record<string, string> = {},
  ): Promise<Uint8Array> {
    const response = await this.send(
      `${DRIVE_API}${path}`,
      {
        headers: {
          ...extra,
          Authorization: `Bearer ${await this.accessToken()}`,
        },
      },
      TRANSFER_TIMEOUT_MS,
    );
    if (!response.ok) throw await apiError(response);
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel();
      throw new GoogleDriveApiError('too_large', null, 'over_limit');
    }
    if (!response.body) return new Uint8Array(0);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new GoogleDriveApiError('too_large', null, 'over_limit');
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof GoogleDriveApiError) throw error;
      throw new GoogleDriveApiError('failed', null, transferReason(error));
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }

  /** One token for the whole service account, shared and renewed early. */
  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - TOKEN_MARGIN_MS > Date.now()) {
      return this.token.value;
    }
    this.pendingToken ??= this.fetchToken().finally(() => {
      this.pendingToken = null;
    });
    return this.pendingToken;
  }

  private async fetchToken(): Promise<string> {
    const account = this.account;
    if (!account) {
      throw new GoogleDriveApiError('failed', null, 'not_configured');
    }
    const token =
      account.privateKey !== null
        ? await this.keyFileToken(account.clientEmail, account.privateKey)
        : await this.actAsToken(account.clientEmail);
    this.token = token;
    return token.value;
  }

  /** A key file's signed assertion, traded for a token. */
  private async keyFileToken(
    clientEmail: string,
    privateKey: string,
  ): Promise<{ value: string; expiresAt: number }> {
    const now = Math.floor(Date.now() / 1000);
    const assertion = signJwt(
      { clientEmail, privateKey },
      {
        iss: clientEmail,
        scope: SCOPE,
        aud: TOKEN_URL,
        iat: now,
        exp: now + 3600,
      },
    );
    const response = await this.send(
      TOKEN_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }).toString(),
      },
      TIMEOUT_MS,
    );
    if (!response.ok) throw await apiError(response);
    const body = (await response.json()) as {
      access_token?: unknown;
      expires_in?: unknown;
    };
    return oauthToken(body);
  }

  /**
   * No key file (#5434): the runtime identity's own token from the metadata
   * server, then IAM Credentials' `generateAccessToken` for a Drive-only
   * token that acts as the Drive account. Google refuses the second call
   * unless the runtime identity holds Service Account Token Creator on it.
   */
  private async actAsToken(
    clientEmail: string,
  ): Promise<{ value: string; expiresAt: number }> {
    const runtime = await this.send(
      METADATA_TOKEN_URL,
      { headers: { 'Metadata-Flavor': 'Google' } },
      TIMEOUT_MS,
    );
    if (!runtime.ok) {
      throw new GoogleDriveApiError(
        'failed',
        runtime.status,
        'no_runtime_token',
      );
    }
    const own = oauthToken(
      (await runtime.json()) as {
        access_token?: unknown;
        expires_in?: unknown;
      },
    );
    const response = await this.send(
      `${IAM_CREDENTIALS_API}/projects/-/serviceAccounts/${encodeURIComponent(clientEmail)}:generateAccessToken`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${own.value}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ scope: [SCOPE], lifetime: '3600s' }),
      },
      TIMEOUT_MS,
    );
    if (!response.ok) {
      // A refusal here is the setup (the Token Creator grant, the account's
      // address, or the IAM Credentials API switched off), never a folder:
      // it goes to the logs tagged `act_as_`, and a quota keeps its back-off.
      const error = await apiError(response);
      throw new GoogleDriveApiError(
        error.kind === 'rate_limited' ? 'rate_limited' : 'failed',
        error.status,
        `act_as_${error.reason}`,
      );
    }
    const body = (await response.json()) as {
      accessToken?: unknown;
      expireTime?: unknown;
    };
    if (typeof body.accessToken !== 'string') {
      throw new GoogleDriveApiError('failed', null, 'no_access_token');
    }
    const expiresAt =
      typeof body.expireTime === 'string' ? Date.parse(body.expireTime) : NaN;
    return {
      value: body.accessToken,
      expiresAt: Number.isFinite(expiresAt)
        ? expiresAt
        : Date.now() + 3600 * 1000,
    };
  }

  private async send(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new GoogleDriveApiError('failed', null, transferReason(error));
    }
  }
}

/**
 * Google's header for a file a link opens only with its resource key (some
 * files shared by link before 2021). Empty without one.
 */
function resourceKeyHeader(
  id: string,
  resourceKey: string | null | undefined,
): Record<string, string> {
  return resourceKey
    ? { 'X-Goog-Drive-Resource-Keys': `${id}/${resourceKey}` }
    : {};
}

/** An OAuth token response, as a token and when it expires. */
function oauthToken(body: { access_token?: unknown; expires_in?: unknown }): {
  value: string;
  expiresAt: number;
} {
  if (typeof body.access_token !== 'string') {
    throw new GoogleDriveApiError('failed', null, 'no_access_token');
  }
  const lifetime = typeof body.expires_in === 'number' ? body.expires_in : 3600;
  return { value: body.access_token, expiresAt: Date.now() + lifetime * 1000 };
}

function transferReason(error: unknown): string {
  return error instanceof Error && error.name === 'TimeoutError'
    ? 'timeout'
    : 'network';
}

function base64Url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

/** An RS256 JWT signed with the service account's key. */
export function signJwt(
  account: { clientEmail: string; privateKey: string },
  claims: Record<string, unknown>,
): string {
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify(claims));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(account.privateKey, 'base64url')}`;
}

function toItem(raw: unknown): GoogleDriveItem {
  const file = (raw ?? {}) as Record<string, unknown>;
  const size = typeof file.size === 'string' ? Number(file.size) : NaN;
  return {
    id: typeof file.id === 'string' ? file.id : '',
    name: typeof file.name === 'string' ? file.name : '',
    mimeType: typeof file.mimeType === 'string' ? file.mimeType : '',
    modifiedTime:
      typeof file.modifiedTime === 'string' ? file.modifiedTime : '',
    size: Number.isFinite(size) ? size : null,
    webViewLink: typeof file.webViewLink === 'string' ? file.webViewLink : null,
    description: typeof file.description === 'string' ? file.description : null,
    parents: Array.isArray(file.parents)
      ? file.parents.filter((id): id is string => typeof id === 'string')
      : [],
    trashed: file.trashed === true,
    ...(isRecord(file.capabilities)
      ? { canEdit: file.capabilities.canEdit === true }
      : {}),
    resourceKey:
      typeof file.resourceKey === 'string' && file.resourceKey !== ''
        ? file.resourceKey
        : null,
    permissionIds: Array.isArray(file.permissionIds)
      ? file.permissionIds.filter((id): id is string => typeof id === 'string')
      : [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Google's error, by kind, with its short reason and nothing else. */
async function apiError(response: Response): Promise<GoogleDriveApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON: the status alone says what happened.
  }
  const status = response.status;
  const oauthError = (body as { error?: unknown } | null)?.error;
  const apiReason = (
    body as { error?: { errors?: { reason?: unknown }[] } } | null
  )?.error?.errors?.[0]?.reason;
  // IAM Credentials answers in the newer shape: `error.status`, no `errors`.
  const rpcStatus = (body as { error?: { status?: unknown } } | null)?.error
    ?.status;
  const reason =
    typeof oauthError === 'string'
      ? oauthError
      : typeof apiReason === 'string'
        ? apiReason
        : typeof rpcStatus === 'string'
          ? rpcStatus
          : `http_${status}`;
  if (status === 404)
    return new GoogleDriveApiError('not_found', status, reason);
  if (status === 429 || RATE_LIMIT_REASONS.has(reason)) {
    return new GoogleDriveApiError('rate_limited', status, reason);
  }
  if (reason === 'exportSizeLimitExceeded') {
    return new GoogleDriveApiError('too_large', status, reason);
  }
  // The Drive API switched off in the Google Cloud project is a setup fault,
  // not a folder Frapp can't see: it goes to the logs, not to the officer.
  if (CONFIG_REASONS.has(reason)) {
    return new GoogleDriveApiError('failed', status, reason);
  }
  if (status === 403)
    return new GoogleDriveApiError('forbidden', status, reason);
  return new GoogleDriveApiError('failed', status, reason);
}
