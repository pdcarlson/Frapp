/**
 * How long an idle callback may wait before it runs anyway. Long enough that
 * the first screen's reads go out first on a slow connection, short enough
 * that a page kept busy still gets there.
 */
const IDLE_TIMEOUT_MS = 4000;

/**
 * Runs `run` once the page has loaded and the main thread is idle: the slot
 * for downloads nothing on the first screen waits for (#3716). On a slow
 * connection every byte fetched before the first screen delays it, so code
 * that only a later click or a background SDK needs goes here instead.
 */
export function afterFirstPaint(run: () => void): void {
  if (typeof window === "undefined") return;
  const whenIdle = () => {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(() => run(), { timeout: IDLE_TIMEOUT_MS });
    } else {
      window.setTimeout(run, 1);
    }
  };
  if (document.readyState === "complete") whenIdle();
  else window.addEventListener("load", whenIdle, { once: true });
}
