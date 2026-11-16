import { createSign } from 'node:crypto';
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

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
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
const CONFIG_REASONS = new Set(['accessNotConfigured', 'SERVICE_DISABLED']);
const RATE_LIMIT_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'quotaExceeded',
  'dailyLimitExceeded',
]);

/**
 * Google Drive for connected chapter folders (#5157), over `fetch` with a
 * service account's signed assertion. No Google SDK, as with
 * `GoogleCalendarApiClient`: these are four plain calls.
 *
 * Reads `GOOGLE_DRIVE_CREDENTIALS_JSON` (`config/google-drive-config.ts`).
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

  async getItem(id: string): Promise<GoogleDriveItem> {
    const body = await this.json(
      `/files/${encodeURIComponent(id)}?${new URLSearchParams({
        fields: ITEM_FIELDS,
        supportsAllDrives: 'true',
      }).toString()}`,
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

  async download(fileId: string, maxBytes: number): Promise<Uint8Array> {
    return this.bytes(
      `/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
      maxBytes,
    );
  }

  async exportAs(
    fileId: string,
    mimeType: string,
    maxBytes: number,
  ): Promise<Uint8Array> {
    return this.bytes(
      `/files/${encodeURIComponent(fileId)}/export?${new URLSearchParams({
        mimeType,
      }).toString()}`,
      maxBytes,
    );
  }

  private async json(path: string): Promise<unknown> {
    const response = await this.send(
      `${DRIVE_API}${path}`,
      {
        headers: { Authorization: `Bearer ${await this.accessToken()}` },
      },
      TIMEOUT_MS,
    );
    if (!response.ok) throw await apiError(response);
    return response.json();
  }

  private async bytes(path: string, maxBytes: number): Promise<Uint8Array> {
    const response = await this.send(
      `${DRIVE_API}${path}`,
      {
        headers: { Authorization: `Bearer ${await this.accessToken()}` },
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
    const now = Math.floor(Date.now() / 1000);
    const assertion = signJwt(account, {
      iss: account.clientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    });
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
    if (typeof body.access_token !== 'string') {
      throw new GoogleDriveApiError('failed', null, 'no_access_token');
    }
    const lifetime =
      typeof body.expires_in === 'number' ? body.expires_in : 3600;
    this.token = {
      value: body.access_token,
      expiresAt: Date.now() + lifetime * 1000,
    };
    return body.access_token;
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
  account: GoogleDriveServiceAccount,
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
  };
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
  const reason =
    typeof oauthError === 'string'
      ? oauthError
      : typeof apiReason === 'string'
        ? apiReason
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
