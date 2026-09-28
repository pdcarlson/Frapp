/**
 * The one PUT to a Supabase Storage signed upload URL, shared by every web
 * upload surface (chat attachments, documents, backwork, service proof, the
 * Discord archive import).
 *
 * Deliberately a plain async function, not a hook: the Discord import runs it
 * inside a bounded worker pool and counts failures per file, which a single
 * `useMutation` pending state can't model. `useUploadSignedUrl` wraps it for
 * the chat composer, which does want the mutation state.
 *
 * ## Why the caller passes the content type
 *
 * A signed upload URL pins no content type: the bucket checks the PUT's own
 * `content-type` against its `allowed_mime_types`. The type to send is the one
 * the caller resolved and the API validated when it minted the URL, not the
 * browser's `file.type`, which is empty for legacy Office files and for several
 * formats a Discord archive is full of (.heic, .mkv, .avif). An empty type
 * fails the bucket's allowlist.
 */

/** A PUT the storage bucket answered with a non-2xx status. */
export class SignedUploadError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SignedUploadError";
  }
}

export interface PutSignedUploadInput {
  signedUrl: string;
  body: Blob;
  /** The type the upload URL was requested with. */
  contentType: string;
  /** Send `x-upsert: true`, so a retried PUT to the same path overwrites. */
  upsert?: boolean;
  /**
   * The message the thrown `SignedUploadError` carries, which each surface
   * shows its member verbatim. Defaults to `Upload failed (<status>)`.
   */
  describeRejection?: (status: number) => string;
}

/**
 * PUTs `body` to `signedUrl`. Resolves on a 2xx; throws `SignedUploadError`
 * on any other status. A network failure rejects with `fetch`'s own error.
 */
export async function putSignedUpload({
  signedUrl,
  body,
  contentType,
  upsert = false,
  describeRejection = (status) => `Upload failed (${status})`,
}: PutSignedUploadInput): Promise<void> {
  const headers: Record<string, string> = { "content-type": contentType };
  if (upsert) headers["x-upsert"] = "true";
  const response = await fetch(signedUrl, { method: "PUT", body, headers });
  if (!response.ok) {
    throw new SignedUploadError(
      response.status,
      describeRejection(response.status),
    );
  }
}
