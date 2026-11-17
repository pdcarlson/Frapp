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
}

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
  /** Whether a Drive service account is configured, with or without a key file. */
  isConfigured(): boolean;
  /** The address a chapter shares its folder with, or null when unconfigured. */
  serviceAccountEmail(): string | null;
  /**
   * A short code only this server can make for `subject`, keyed by
   * `GOOGLE_DRIVE_PROOF_SECRET` (or a key file's private key when that is
   * unset), or null when unconfigured. Connecting
   * asks for it in the folder (#5185): only someone who can edit the folder
   * can put it there.
   */
  proofCode(subject: string): string | null;
  /** One item by id, with its Description and parents. */
  getItem(id: string): Promise<GoogleDriveItem>;
  /** A folder's children, not trashed, every page. */
  listChildren(folderId: string): Promise<GoogleDriveItem[]>;
  /** A stored file's bytes; refuses past `maxBytes` with `too_large`. */
  download(fileId: string, maxBytes: number): Promise<Uint8Array>;
  /** A Google Doc, Sheet or Slides exported as `mimeType`. */
  exportAs(
    fileId: string,
    mimeType: string,
    maxBytes: number,
  ): Promise<Uint8Array>;
}
