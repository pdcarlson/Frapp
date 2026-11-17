import { MemberFacingError } from "@repo/hooks/error-copy";

/**
 * A bulk upload step that stopped answering. Without a bound, a request
 * the network never answers, or a sign-in check stuck behind one, left the
 * item on "Uploading" for as long as the tab stayed open, with no error and
 * no Retry (staging, 2026-11-17). Its message is written for members: the
 * queue shows it on the item beside Retry.
 */
export class UploadStalledError extends MemberFacingError {
  constructor(
    message = "This upload stopped responding. Check your connection, then try again.",
  ) {
    super(message);
    this.name = "UploadStalledError";
  }
}

/**
 * Settles like `work`, or rejects with an `UploadStalledError` once `ms` pass
 * first. The work itself isn't stopped (a caller with a fetch passes its own
 * abort signal for that); a late answer is ignored.
 */
export function within<T>(
  work: Promise<T>,
  ms: number,
  message?: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stalled = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new UploadStalledError(message)), ms);
  });
  return Promise.race([work, stalled]).finally(() => clearTimeout(timer));
}
