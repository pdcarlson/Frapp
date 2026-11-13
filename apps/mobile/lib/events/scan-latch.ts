/**
 * Single-shot latch for a check-in, one per event.
 *
 * It was written for the in-app scanner, whose camera handed the same code
 * over many times a second; the scanner is gone (2026-11-13), and the rule
 * still holds for what is left. A camera link can be opened twice (a double
 * tap on the banner, or the screen re-rendering with the same token), and a
 * double tap on the typed code's button lands its second press before the
 * re-render that disables it. Each of those must send one check-in, not two:
 * the second would only come back a 409.
 *
 * The latch releases only when the caller says so, after the server has
 * answered, success or failure. Releasing on a timer instead would let a
 * second request through whenever the response outran the timeout.
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
