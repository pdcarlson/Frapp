import { settle } from "@/lib/bulk-upload/queue";

/**
 * Coalesces one-at-a-time calls into batch requests: each `add` waits a
 * moment for others, then one `run` serves up to `max` of them, and each
 * caller gets its own answer back. The Documents folder import (#2242) runs
 * its per-file uploads through two of these, so six files finishing together
 * mint their upload links in one call and file in one call, under the
 * fan-out throttle's 10 calls a minute.
 *
 * `run` must answer in the order it was given. When it throws, every caller
 * in that batch gets the error.
 */
export function createBatcher<In, Out>(
  run: (items: In[]) => Promise<Out[]>,
  { max = 25, waitMs = 40 }: { max?: number; waitMs?: number } = {},
): { add: (item: In) => Promise<Out> } {
  type Waiting = {
    item: In;
    resolve: (out: Out) => void;
    reject: (error: unknown) => void;
  };
  let waiting: Waiting[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush() {
    timer = null;
    while (waiting.length > 0) {
      const batch = waiting.slice(0, max);
      waiting = waiting.slice(max);
      void settle(() => run(batch.map((w) => w.item))).then(
        (outs) => {
          batch.forEach((w, i) => {
            if (i < outs.length) w.resolve(outs[i]!);
            else w.reject(new Error("The server answered fewer items than sent."));
          });
        },
        (error: unknown) => batch.forEach((w) => w.reject(error)),
      );
    }
  }

  return {
    add: (item) =>
      new Promise<Out>((resolve, reject) => {
        waiting.push({ item, resolve, reject });
        if (waiting.length >= max) {
          if (timer) clearTimeout(timer);
          flush();
        } else {
          timer ??= setTimeout(flush, waitMs);
        }
      }),
  };
}
