/**
 * The Google side of a chapter's connected Drive folder (#5157): a service
 * account reading what a chapter shared with it, only the calls Frapp makes.
 * Read-only (`drive.readonly` on the service account's own access, which is
 * exactly the files shared with it).
 */
export const GOOGLE_DRIVE_API = 'GOOGLE_DRIVE_API';

export const GOOGLE_DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

/** A file or folder in Drive, as a listing reads it. */
export interface GoogleDriveItem {
  id: string;
  name: string;
  mimeType: string;
  /** RFC 3339. */
  modifiedTime: string;
  /** Bytes, for a stored file; null for a Google Doc, Sheet, Slides and folders. */
  size: number | null;
  /** The item's page in Drive. */
  webViewLink: string | null;
  /**
   * The item's Description in Drive, for the connect check's code (#5185).
   * Only `getItem` asks Google for it: a listing's items always carry null.
   */
  description?: string | null;
  /**
   * The folders that hold it, as far as the service account can see them.
   * Only `getItem` asks Google for them: a listing's items always carry [].
   */
  parents?: string[];
  /**
   * Who has access, by permission id, as far as Google shows them to the
   * service account. `anyoneWithLink` or `anyone` means anyone with the link
   * can open it (#5434). Only `getItem` asks for them; empty when Google
   * doesn't say.
   */
  permissionIds?: string[];
  /** In the owner's trash. Only `getItem` asks; a listing leaves trash out. */
  trashed?: boolean;
  /**
   * The key a link must carry to open the file for someone without direct
   * access (Google's 2021 link-sharing update), or null when it needs none.
   * Only `getItem` asks.
   */
  resourceKey?: string | null;
}

/**
 * The permission ids Drive gives "anyone with the link" and "public on the
 * web" (#5434): a file carrying one is open to whoever has its link.
 */
export const GOOGLE_DRIVE_LINK_PERMISSION_IDS: ReadonlySet<string> = new Set([
  'anyoneWithLink',
  'anyone',
]);

export type GoogleDriveErrorKind =
  /** The item is gone, or was never shared with the service account (404). */
  | 'not_found'
  /** Google refused this item (403 that isn't a rate limit). */
  | 'forbidden'
  /** A quota or rate limit (403 rate limits, 429). */
  | 'rate_limited'
  /** The file is larger than Google exports, or than Frapp takes. */
  | 'too_large'
  /** Anything else: a 5xx, a timeout, a network failure, a 400. */
  | 'failed';

export class GoogleDriveApiError extends Error {
  constructor(
    readonly kind: GoogleDriveErrorKind,
    readonly status: number | null,
    /** Google's own short reason, never a token or a body. */
    readonly reason: string,
  ) {
    super(`Google Drive: ${kind}${status ? ` (${status})` : ''}: ${reason}`);
    this.name = 'GoogleDriveApiError';
  }
}

export interface IGoogleDriveApi {
  /** Whether a service account key is configured. */
  isConfigured(): boolean;
  /** The address a chapter shares its folder with, or null when unconfigured. */
  serviceAccountEmail(): string | null;
  /**
   * A short code only this server can make for `subject`, keyed by the
   * service account's own private key, or null when unconfigured. Connecting
   * asks for it in the folder (#5185): only someone who can edit the folder
   * can put it there.
   */
  proofCode(subject: string): string | null;
  /**
   * One item by id, with its Description, parents and permission ids.
   * `resourceKey` is the `resourcekey` some older link-shared files need.
   */
  getItem(id: string, resourceKey?: string | null): Promise<GoogleDriveItem>;
  /** A folder's children, not trashed, every page. */
  listChildren(folderId: string): Promise<GoogleDriveItem[]>;
  /** A stored file's bytes; refuses past `maxBytes` with `too_large`. */
  download(
    fileId: string,
    maxBytes: number,
    resourceKey?: string | null,
  ): Promise<Uint8Array>;
  /** A Google Doc, Sheet or Slides exported as `mimeType`. */
  exportAs(
    fileId: string,
    mimeType: string,
    maxBytes: number,
    resourceKey?: string | null,
  ): Promise<Uint8Array>;
}
