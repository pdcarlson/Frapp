/**
 * Single-shot latch for `CameraView.onBarcodeScanned`.
 *
 * expo-camera fires that callback continuously while a code stays in frame —
 * many times per second, not once per physical code. Without a latch, holding
 * a phone steady for one second turns one QR into dozens of concurrent
 * `POST .../check-in` calls: a self-inflicted burst against the API's write
 * throttle, and a pile of 409s behind the one request that actually won.
 *
 * Kept out of the screen so the rule can be tested without a camera, a render
 * tree, or a fake timer. The screen holds one of these in a ref.
 *
 * The latch releases only when the caller says so — after the server has
 * answered, success or failure. Releasing on a timer instead would reintroduce
 * the burst whenever the response outran the timeout, which is exactly the
 * network condition the debounce exists for.
 */
export interface ScanLatch {
  /**
   * Claim this read. `true` means the caller owns the attempt and must
   * eventually `release()`; `false` means a scan is already in flight and this
   * read must be dropped silently.
   */
  accept(code: string): boolean;
  /** Release after the server responds, so the member can scan again. */
  release(): void;
  /** The code currently in flight, or `null`. */
  readonly current: string | null;
}

export function createScanLatch(): ScanLatch {
  let latched: string | null = null;

  return {
    accept(code: string): boolean {
      if (latched !== null) return false;
      if (!code) return false;
      latched = code;
      return true;
    },
    release(): void {
      latched = null;
    },
    get current(): string | null {
      return latched;
    },
  };
}
