/**
 * The bulk upload queue that stays ahead of the person (#3499), shared by
 * backwork's bulk upload and the Documents folder import (#2242).
 *
 * Each file moves through:
 *
 *   queued → preparing → ready → (person reviews and submits) →
 *   waiting → finishing → done
 *
 * and can land in `failed` from either background step. Only review needs the
 * person. `prepare` (hash, load, first-page render) runs on the current item
 * and up to `lookahead` items past it, so pressing Next shows a document that
 * is already loaded. `finish` (flatten, upload, confirm) runs behind the
 * person, at most `maxFinishing` at a time, so submitting never waits on the
 * network.
 *
 * Framework-free on purpose: React reads it through `useSyncExternalStore`
 * (`getSnapshot` returns a new object only when something changed), and the
 * spec drives it with controlled promises.
 *
 * Memory (#3540): `trim` drops what only review needed (backwork's page
 * previews) the moment an item is submitted, and with `sizeOf` and
 * `maxHeldBytes` the queue stops preparing ahead of the current item while
 * submitted items waiting to upload hold more than the budget, picking up
 * again as they finish. One tab never piles up hundreds of MB of documents
 * the person has already sent on.
 *
 * `close()` is what a page calls when it unmounts. It is not the end of the
 * queue: submitted items keep finishing (the person pressed Upload; a link
 * click mustn't drop that), review items give back their loaded PDFs, and
 * `open()` picks up where it left off. That is also what makes React
 * StrictMode's mount, unmount, mount in development harmless.
 */
export type ItemStatus =
  | "queued"
  | "preparing"
  | "ready"
  | "waiting"
  | "finishing"
  | "done"
  | "failed";

export type QueueItem<P, S> = {
  id: string;
  file: File;
  status: ItemStatus;
  prepared?: P;
  submission?: S;
  error?: string;
  /** Which background step failed, so retry knows what to re-run. */
  failedStage?: "prepare" | "finish";
  /** The failure leaves nothing to save (say, already in the library). */
  final?: boolean;
};

export type QueueSnapshot<P, S> = {
  items: readonly QueueItem<P, S>[];
  /** The item the person is reviewing, or null when nothing is left to review. */
  currentId: string | null;
};

export type BulkQueueOptions<P, S> = {
  /** Gets the item's id too, so a duplicate check can tell an item from itself. */
  prepare: (file: File, id: string) => Promise<P>;
  finish: (job: { file: File; prepared: P; submission: S }) => Promise<void>;
  /** Frees what `prepare` made (a loaded PDF, object URLs) once it's unneeded. */
  release?: (prepared: P) => void;
  /**
   * Frees what only review needed when an item is submitted, keeping what
   * `finish` uses; returns what the item keeps.
   */
  trim?: (prepared: P) => P;
  /** Bytes a prepared item holds in memory, for `maxHeldBytes`. */
  sizeOf?: (prepared: P) => number;
  /**
   * While submitted items not yet uploaded hold more than this (by
   * `sizeOf`), only the current item is prepared, with no lookahead.
   */
  maxHeldBytes?: number;
  /** Items prepared past the current one. */
  lookahead?: number;
  /**
   * Prepares running at once. Unlimited by default, since `lookahead`
   * already bounds them; a folder import, which prepares (hashes) every file
   * ahead, sets it so only a couple of files are read into memory at once.
   */
  maxPreparing?: number;
  maxFinishing?: number;
  /** Whether a failure leaves nothing to save, so it doesn't count as unsaved. */
  isFinal?: (error: unknown, stage: "prepare" | "finish") => boolean;
  /** Turns a thrown value into the line shown on the item. */
  describeError?: (error: unknown, stage: "prepare" | "finish") => string;
};

const IN_REVIEW: ReadonlySet<ItemStatus> = new Set([
  "queued",
  "preparing",
  "ready",
]);

let nextId = 0;

export class BulkUploadQueue<P, S> {
  private items: QueueItem<P, S>[] = [];
  private snapshot: QueueSnapshot<P, S> = { items: [], currentId: null };
  private listeners = new Set<() => void>();
  private closed = false;
  private pumping = false;
  private repump = false;
  private readonly lookahead: number;
  private readonly maxFinishing: number;
  private readonly maxPreparing: number;

  constructor(private readonly options: BulkQueueOptions<P, S>) {
    this.lookahead = options.lookahead ?? 2;
    this.maxFinishing = options.maxFinishing ?? 2;
    this.maxPreparing = options.maxPreparing ?? Number.POSITIVE_INFINITY;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): QueueSnapshot<P, S> => this.snapshot;

  add(files: readonly File[]): void {
    for (const file of files) {
      nextId += 1;
      this.items.push({ id: `bw-${nextId}`, file, status: "queued" });
    }
    this.changed();
  }

  /** Hands the current, prepared item to the background finish step. */
  submit(id: string, submission: S): void {
    const item = this.find(id);
    if (!item || item.status !== "ready") return;
    const prepared =
      item.prepared && this.options.trim
        ? this.options.trim(item.prepared)
        : item.prepared;
    this.patch(id, {
      status: "waiting",
      submission,
      prepared,
      error: undefined,
    });
  }

  /** Re-runs whichever background step failed, with what it already has. */
  retry(id: string): void {
    const item = this.find(id);
    if (!item || item.status !== "failed") return;
    if (item.failedStage === "finish" && item.prepared && item.submission) {
      this.patch(id, {
        status: "waiting",
        error: undefined,
        failedStage: undefined,
        final: undefined,
      });
    } else {
      this.patch(id, {
        status: "queued",
        error: undefined,
        failedStage: undefined,
      });
    }
  }

  /** Drops an item that isn't mid-upload. */
  remove(id: string): void {
    const item = this.find(id);
    if (!item || item.status === "finishing") return;
    if (item.prepared) this.options.release?.(item.prepared);
    this.items = this.items.filter((it) => it.id !== id);
    this.changed();
  }

  /** Removes finished items from the list. */
  clearDone(): void {
    this.items = this.items.filter((it) => it.status !== "done");
    this.changed();
  }

  /**
   * Stops preparing and frees every loaded document still in review (they
   * load again on `open()`), but lets submitted items finish.
   */
  close(): void {
    this.closed = true;
    for (const item of this.reviewLine()) {
      if (item.status === "ready" && item.prepared) {
        this.options.release?.(item.prepared);
        this.patch(item.id, { status: "queued", prepared: undefined });
      }
    }
  }

  /**
   * Ends the batch: frees every loaded document and empties the list. An
   * upload already running settles into nothing and frees its document then.
   */
  discard(): void {
    this.closed = true;
    for (const item of this.items) {
      if (item.status !== "finishing" && item.prepared) {
        this.options.release?.(item.prepared);
      }
    }
    this.items = [];
    this.publish();
  }

  open(): void {
    this.closed = false;
    this.changed();
  }

  /** Whether the item is still in the batch (not removed or cleared). */
  has(id: string): boolean {
    return this.find(id) !== undefined;
  }

  /** Submitted items not finished yet. */
  pendingUploads(): number {
    return this.items.filter(
      (it) => it.status === "waiting" || it.status === "finishing",
    ).length;
  }

  /** Items that would be lost if the tab went away: everything not uploaded yet. */
  unsaved(): number {
    return this.items.filter(
      (it) =>
        it.status !== "done" &&
        !(it.status === "failed" && (it.failedStage === "prepare" || it.final)),
    ).length;
  }

  private find(id: string): QueueItem<P, S> | undefined {
    return this.items.find((it) => it.id === id);
  }

  private patch(id: string, update: Partial<QueueItem<P, S>>): void {
    let found = false;
    this.items = this.items.map((it) => {
      if (it.id !== id) return it;
      found = true;
      return { ...it, ...update };
    });
    if (found) this.changed();
  }

  /** The review line: unsubmitted items, plus a failed prepare the person must act on. */
  private reviewLine(): QueueItem<P, S>[] {
    return this.items.filter(
      (it) =>
        IN_REVIEW.has(it.status) ||
        (it.status === "failed" && it.failedStage === "prepare"),
    );
  }

  /** Whether submitted, not-yet-uploaded items hold more than the budget. */
  private overBudget(): boolean {
    const { sizeOf, maxHeldBytes } = this.options;
    if (!sizeOf || maxHeldBytes === undefined) return false;
    let held = 0;
    for (const item of this.items) {
      if (
        (item.status === "waiting" || item.status === "finishing") &&
        item.prepared
      ) {
        held += sizeOf(item.prepared);
      }
    }
    return held > maxHeldBytes;
  }

  private changed(): void {
    this.publish();
    this.pump();
  }

  private publish(): void {
    const line = this.reviewLine();
    this.snapshot = { items: this.items, currentId: line[0]?.id ?? null };
    for (const listener of this.listeners) listener();
  }

  /**
   * Starts whatever work the current state calls for. Re-entrant calls (a
   * listener that submits, say) set `repump` instead of recursing, so starts
   * always happen in queue order and each item is started once.
   */
  private pump(): void {
    if (this.pumping) {
      this.repump = true;
      return;
    }
    this.pumping = true;
    try {
      do {
        this.repump = false;
        const preparingNow = this.items.filter(
          (it) => it.status === "preparing",
        ).length;
        const toPrepare = this.closed
          ? []
          : this.reviewLine()
              .slice(0, this.overBudget() ? 1 : this.lookahead + 1)
              .filter((it) => it.status === "queued")
              .slice(0, Math.max(0, this.maxPreparing - preparingNow));
        let finishing = this.items.filter(
          (it) => it.status === "finishing",
        ).length;
        const toFinish: QueueItem<P, S>[] = [];
        for (const item of this.items) {
          if (finishing >= this.maxFinishing) break;
          if (item.status === "waiting") {
            finishing += 1;
            toFinish.push(item);
          }
        }
        if (toPrepare.length === 0 && toFinish.length === 0) break;

        const preparing = new Set(toPrepare.map((it) => it.id));
        const finishingIds = new Set(toFinish.map((it) => it.id));
        this.items = this.items.map((it) =>
          preparing.has(it.id)
            ? { ...it, status: "preparing" }
            : finishingIds.has(it.id)
              ? { ...it, status: "finishing" }
              : it,
        );
        this.publish();
        for (const item of toPrepare) this.runPrepare(item);
        for (const item of toFinish) this.runFinish(item);
      } while (this.repump);
    } finally {
      this.pumping = false;
    }
  }

  private runPrepare(item: QueueItem<P, S>): void {
    settle(() => this.options.prepare(item.file, item.id)).then(
      (prepared) => {
        if (!this.find(item.id)) {
          this.options.release?.(prepared);
          return;
        }
        if (this.closed) {
          // Nobody is reviewing; load it again when the page comes back.
          this.options.release?.(prepared);
          this.patch(item.id, { status: "queued" });
          return;
        }
        this.patch(item.id, { status: "ready", prepared });
      },
      (error: unknown) =>
        this.patch(item.id, {
          status: "failed",
          failedStage: "prepare",
          error: this.describe(error, "prepare"),
        }),
    );
  }

  private runFinish(item: QueueItem<P, S>): void {
    const { prepared, submission } = item;
    if (!prepared || submission === undefined) return;
    settle(() =>
      this.options.finish({ file: item.file, prepared, submission }),
    ).then(
      () => {
        this.options.release?.(prepared);
        this.patch(item.id, { status: "done", prepared: undefined });
      },
      (error: unknown) => {
        // Discarded while it ran: nothing will retry it, so free it now.
        if (!this.find(item.id)) {
          this.options.release?.(prepared);
          return;
        }
        this.patch(item.id, {
          status: "failed",
          failedStage: "finish",
          final: this.options.isFinal?.(error, "finish") ?? false,
          error: this.describe(error, "finish"),
        });
      },
    );
  }

  private describe(error: unknown, stage: "prepare" | "finish"): string {
    if (this.options.describeError) {
      return this.options.describeError(error, stage);
    }
    return error instanceof Error ? error.message : "Something went wrong.";
  }
}

/** Calls `run` now, turning a synchronous throw into a rejection. */
function settle<T>(run: () => Promise<T>): Promise<T> {
  try {
    return run();
  } catch (error) {
    return Promise.reject(error);
  }
}
