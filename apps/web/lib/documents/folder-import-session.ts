/**
 * One Documents folder import (#2242): the files an officer dropped or
 * picked, checked on the device, suggested a folder, type and title each, and
 * filed when they press Import.
 *
 * Nothing reaches the server before Import. The check (type, size, the same
 * bytes twice in this import, a likely copy already in Documents) runs here.
 * Import then sends every kept file through the existing signed uploads, a
 * few at a time, and files each document as its upload lands, so a document
 * exists only once its file does. There is no server-side draft, so a tab
 * closed mid-import keeps what was filed and loses the rest (a later import
 * of the same folder flags what's already in Documents).
 *
 * The files ride the shared bulk upload queue (`lib/bulk-upload/queue.ts`):
 * its prepare step hashes each file, two at a time so a large folder never
 * sits in memory, and keeps only the hash; its finish step streams the file
 * from disk to storage. Upload links and filing go through the 25-file batch
 * routes (`createBatcher`), with a wait and a retry when the API says to slow
 * down.
 */
import { serverMessageOf, statusOf } from "@repo/api-sdk";
import { MemberFacingError } from "@repo/hooks/error-copy";
import {
  BulkUploadQueue,
  type QueueItem,
  type QueueSnapshot,
} from "@/lib/bulk-upload/queue";
import { createBatcher } from "@/lib/bulk-upload/batcher";
import { relativePath } from "@/lib/bulk-upload/collect-files";
import { sha256Hex } from "@/lib/bulk-upload/hash";
import {
  checkImportFile,
  findInLibrary,
  suggestForImport,
  type DuplicateReason,
  type ImportSuggestion,
  type LeftOutReason,
} from "@/lib/documents/folder-import";

export type Prepared = { hash: string };

export type Submission = {
  title: string;
  documentType: string;
  folder: string;
  contentType: string;
};

export type MintRequest = {
  filename: string;
  content_type: string;
  size_bytes: number;
};
export type MintTicket = { upload_url: string; storage_path: string };
export type ConfirmRequest = {
  storage_path: string;
  title: string;
  folder?: string;
  document_type?: string;
  content_type: string;
  byte_size: number;
};
export type ConfirmResult = { storage_path: string; error?: string };

export type ImportDeps = {
  mint: (files: MintRequest[]) => Promise<MintTicket[]>;
  put: (job: { url: string; file: File; contentType: string }) => Promise<void>;
  confirm: (documents: ConfirmRequest[]) => Promise<ConfirmResult[]>;
  /** Throws when the chapter or account the import began in has changed. */
  assertChapter: () => void | Promise<void>;
  /** Called whenever the import has nothing left uploading (to refresh the library). */
  onSettled?: () => void;
  sleep?: (ms: number) => Promise<void>;
  /** How long filing waits for a batch to fill (tests shorten it). */
  confirmWaitMs?: number;
};

/** What the officer sees and edits for one file. */
export type ImportRow = {
  id: string;
  path: string;
  file: File;
  contentType: string;
  suggestion: ImportSuggestion;
  title: string;
  documentType: string;
  folder: string;
  /** Set once the officer ticks or unticks it; else the default applies. */
  include?: boolean;
  /** Title of the library document this file looks like. */
  inLibrary?: string;
};

export type LeftOut = { path: string; reason: LeftOutReason };

export type ImportView = {
  rows: readonly ImportRow[];
  leftOut: readonly LeftOut[];
  /** Files the walk counted but couldn't read. */
  unreadable: number;
  queue: QueueSnapshot<Prepared, Submission>;
  applied: boolean;
};

export type ImportContext = Parameters<typeof suggestForImport>[1] & {
  documents: ReadonlyArray<
    Parameters<typeof suggestForImport>[1]["documents"][number] & {
      title: string;
      storage_path: string;
      byte_size: number | null;
    }
  >;
};

/** Uploads in flight at once. */
const MAX_FINISHING = 6;
/** Files hashed at once, so only these are ever read into memory. */
const MAX_HASHING = 2;
/**
 * Files per batch call: the API's `DOCUMENT_BATCH_MAX`. Both batch routes
 * allow 10 calls a minute, so links are minted ahead in full batches at
 * Import, and filing waits a few seconds for a batch to fill rather than
 * spending a call per finished upload.
 */
const BATCH_MAX = 25;
const CONFIRM_WAIT_MS = 6_000;
/** Waits before retrying a batch the API refused with 429, as backwork's. */
const RATE_LIMIT_WAITS_MS = [15_000, 30_000, 45_000];

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * What one file's upload has done so far. A retry picks up from here: it
 * reuses the minted link (the same storage path), skips the PUT once the bytes
 * are stored, and files that path again, which the API answers with the
 * document it already filed. So a retry after a lost or failed filing call
 * never files a file twice.
 */
type Progress = { ticket?: Promise<MintTicket>; stored?: boolean };

export class FolderImport {
  private rows: ImportRow[] = [];
  private leftOut: LeftOut[] = [];
  private unreadable = 0;
  private applied = false;
  private view: ImportView;
  private listeners = new Set<() => void>();
  private progress = new WeakMap<File, Progress>();
  private readonly mintBatch: (items: MintRequest[]) => Promise<MintTicket[]>;
  private readonly mintOne: { add: (item: MintRequest) => Promise<MintTicket> };
  private unloadGuard: ((event: BeforeUnloadEvent) => void) | null = null;
  private wasBusy = false;
  readonly queue: BulkUploadQueue<Prepared, Submission>;

  constructor(private readonly deps: ImportDeps) {
    const sleep = deps.sleep ?? realSleep;
    const patiently =
      <In, Out>(run: (items: In[]) => Promise<Out[]>) =>
      async (items: In[]) => {
        for (let attempt = 0; ; attempt += 1) {
          await deps.assertChapter();
          try {
            return await run(items);
          } catch (error) {
            const wait = RATE_LIMIT_WAITS_MS[attempt];
            if (statusOf(error) !== 429 || wait === undefined) throw error;
            await sleep(wait);
          }
        }
      };
    this.mintBatch = patiently(deps.mint);
    // A retry whose link was lost mints it alone; Import mints the rest ahead.
    this.mintOne = createBatcher(this.mintBatch, { max: BATCH_MAX });
    const confirm = createBatcher(patiently(deps.confirm), {
      max: BATCH_MAX,
      waitMs: deps.confirmWaitMs ?? CONFIRM_WAIT_MS,
    });

    this.queue = new BulkUploadQueue<Prepared, Submission>({
      lookahead: Number.POSITIVE_INFINITY,
      maxPreparing: MAX_HASHING,
      maxFinishing: MAX_FINISHING,
      prepare: async (file) => ({
        hash: await sha256Hex(new Uint8Array(await file.arrayBuffer())),
      }),
      finish: async ({ file, submission }) => {
        const progress = this.progressOf(file);
        progress.ticket ??= this.mintOne.add(mintRequest(file, submission));
        let ticket: MintTicket;
        try {
          ticket = await progress.ticket;
        } catch (error) {
          progress.ticket = undefined;
          throw error;
        }
        if (!progress.stored) {
          await deps.assertChapter();
          try {
            await deps.put({
              url: ticket.upload_url,
              file,
              contentType: submission.contentType,
            });
          } catch (error) {
            // A link that stopped working (it expires) is minted afresh on
            // retry; nothing was stored under it.
            progress.ticket = undefined;
            throw error;
          }
          progress.stored = true;
        }
        const result = await confirm.add({
          storage_path: ticket.storage_path,
          title: submission.title,
          ...(submission.folder ? { folder: submission.folder } : {}),
          ...(submission.documentType
            ? { document_type: submission.documentType }
            : {}),
          content_type: submission.contentType,
          byte_size: file.size,
        });
        if (result.error) throw new MemberFacingError(result.error);
      },
      describeError: (error) =>
        error instanceof MemberFacingError
          ? error.message
          : statusOf(error) === 429
            ? "Documents is busy. Retry this one in a minute."
            : (serverMessageOf(error) ?? "This one didn't upload. Retry it."),
    });
    this.view = this.build();
    this.queue.subscribe(() => this.publish());
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ImportView => this.view;

  /** Checks the files and adds the ones Documents takes, with suggestions. */
  add(files: readonly File[], context: ImportContext, unreadable = 0): void {
    const kept: File[] = [];
    const added: ImportRow[] = [];
    for (const file of files) {
      const path = relativePath(file);
      const checked = checkImportFile(file);
      if (!checked.ok) {
        this.leftOut.push({ path, reason: checked.reason });
        continue;
      }
      kept.push(file);
      const suggestion = suggestForImport(path, context);
      added.push({
        id: "",
        path,
        file,
        contentType: checked.contentType,
        suggestion,
        title: suggestion.title,
        documentType: suggestion.documentType,
        folder: suggestion.folder,
        inLibrary: findInLibrary(file, context.documents)?.title,
      });
    }
    this.unreadable += unreadable;
    const before = new Set(this.queue.getSnapshot().items.map((it) => it.id));
    this.queue.add(kept);
    // The queue names its items; pair each new one with its row by file.
    const ids = new Map(
      this.queue
        .getSnapshot()
        .items.filter((it) => !before.has(it.id))
        .map((it) => [it.file, it.id]),
    );
    // A new array, so anything memoised on the last view sees the change.
    this.rows = [
      ...this.rows,
      ...added.map((row) => ({ ...row, id: ids.get(row.file) ?? "" })),
    ];
    this.publish();
  }

  /** Edits one file's title, type, folder or whether it's imported. */
  update(
    id: string,
    patch: Partial<
      Pick<ImportRow, "title" | "documentType" | "folder" | "include">
    >,
  ): void {
    this.rows = this.rows.map((row) =>
      row.id === id ? { ...row, ...patch } : row,
    );
    this.publish();
  }

  /** Moves every file suggested into `from` (a group) into `to`. */
  moveGroup(from: string, to: string): void {
    this.rows = this.rows.map((row) =>
      row.folder === from ? { ...row, folder: to } : row,
    );
    this.publish();
  }

  /**
   * Sends every kept, checked file on to upload and filing. A file that
   * couldn't be read, or that the officer left out, leaves the import here,
   * so the progress that follows counts only what is uploading.
   */
  apply(): number {
    const items = new Map(
      this.queue.getSnapshot().items.map((it) => [it.id, it]),
    );
    const duplicates = duplicateReasons(this.rows, this.view.queue);
    const jobs: { id: string; file: File; submission: Submission }[] = [];
    for (const row of this.rows) {
      const item = items.get(row.id);
      if (!item) continue;
      if (item.status !== "ready" || !isIncluded(row, duplicates.get(row.id))) {
        this.queue.remove(row.id);
        continue;
      }
      jobs.push({
        id: row.id,
        file: row.file,
        submission: {
          title: row.title.trim() || row.suggestion.title,
          documentType: row.documentType.trim(),
          folder: row.folder.trim(),
          contentType: row.contentType,
        },
      });
    }
    this.mintAhead(jobs);
    for (const job of jobs) this.queue.submit(job.id, job.submission);
    this.applied = true;
    this.publish();
    return jobs.length;
  }

  retry(id: string): void {
    this.queue.retry(id);
  }

  retryFailed(): void {
    for (const item of this.queue.getSnapshot().items) {
      if (item.status === "failed") this.queue.retry(item.id);
    }
  }

  discard(): void {
    this.queue.discard();
    this.progress = new WeakMap();
    this.rows = [];
    this.leftOut = [];
    this.unreadable = 0;
    this.applied = false;
    this.publish();
  }

  private publish(): void {
    this.view = this.build();
    this.watchBusy();
    for (const listener of this.listeners) listener();
  }

  /** Files with an upload still to finish (waiting or in flight). */
  pending(): number {
    return this.queue.pendingUploads();
  }

  /**
   * While anything is uploading, the browser asks before the tab closes, and
   * the library refreshes once the last one settles. Kept here rather than in
   * the panel, so leaving the Documents page changes neither.
   */
  private watchBusy(): void {
    const busy = this.queue.pendingUploads() > 0;
    if (busy && !this.unloadGuard && typeof window !== "undefined") {
      this.unloadGuard = (event) => event.preventDefault();
      window.addEventListener("beforeunload", this.unloadGuard);
    }
    if (!busy && this.unloadGuard) {
      window.removeEventListener("beforeunload", this.unloadGuard);
      this.unloadGuard = null;
    }
    if (this.wasBusy && !busy) this.deps.onSettled?.();
    this.wasBusy = busy;
  }

  private progressOf(file: File): Progress {
    let progress = this.progress.get(file);
    if (!progress) {
      progress = {};
      this.progress.set(file, progress);
    }
    return progress;
  }

  /**
   * Mints the links for the files about to upload ahead of time, a full
   * batch per call, so the uploads that follow don't each spend one.
   */
  private mintAhead(
    jobs: ReadonlyArray<{ file: File; submission: Submission }>,
  ): void {
    for (let i = 0; i < jobs.length; i += BATCH_MAX) {
      const chunk = jobs.slice(i, i + BATCH_MAX);
      const minted = this.mintBatch(
        chunk.map(({ file, submission }) => mintRequest(file, submission)),
      );
      // Each file's upload awaits its own ticket; a failed batch fails them
      // there (and a retry mints that file alone), never unhandled here.
      minted.catch(() => undefined);
      chunk.forEach(({ file }, index) => {
        this.progressOf(file).ticket = minted.then((tickets) => {
          const ticket = tickets[index];
          if (!ticket) throw new Error("The server answered fewer links than asked.");
          return ticket;
        });
      });
    }
  }

  private build(): ImportView {
    return {
      rows: this.rows,
      leftOut: this.leftOut,
      unreadable: this.unreadable,
      queue: this.queue?.getSnapshot() ?? { items: [], currentId: null },
      applied: this.applied,
    };
  }
}

/**
 * Why each row may be a copy: the same bytes earlier in this import (by
 * hash, once checked), or a likely copy already in Documents.
 */
export function duplicateReasons(
  rows: readonly ImportRow[],
  queue: QueueSnapshot<Prepared, Submission>,
): Map<string, DuplicateReason> {
  const byId = new Map<string, QueueItem<Prepared, Submission>>(
    queue.items.map((it) => [it.id, it]),
  );
  const seen = new Set<string>();
  const reasons = new Map<string, DuplicateReason>();
  for (const row of rows) {
    const hash = byId.get(row.id)?.prepared?.hash;
    if (hash && seen.has(hash)) reasons.set(row.id, "in-import");
    else if (row.inLibrary) reasons.set(row.id, "in-library");
    if (hash) seen.add(hash);
  }
  return reasons;
}

/** Copies start left out; the officer can tick one to import it anyway. */
export function isIncluded(
  row: ImportRow,
  duplicate: DuplicateReason | undefined,
): boolean {
  return row.include ?? duplicate === undefined;
}

function mintRequest(file: File, submission: Submission): MintRequest {
  return {
    filename: file.name,
    content_type: submission.contentType,
    size_bytes: file.size,
  };
}

/*
  The import in progress, kept outside React so leaving the Documents page
  (which unmounts the panel) doesn't drop it: its uploads, its leave-page
  guard and its progress are there when the panel opens again. One at a time,
  for the chapter it began in; the panel shows none for another chapter.
*/
let current: { chapterId: string; run: FolderImport } | null = null;
const currentListeners = new Set<() => void>();

export function subscribeFolderImport(listener: () => void): () => void {
  currentListeners.add(listener);
  return () => currentListeners.delete(listener);
}

/** The import for `chapterId`, if one is in progress or waiting for review. */
export function folderImportFor(chapterId: string | null): FolderImport | null {
  return current && current.chapterId === chapterId ? current.run : null;
}

export function setFolderImport(
  chapterId: string | null,
  run: FolderImport | null,
): void {
  if (current && current.run !== run && current.run.pending() === 0) {
    current.run.discard();
  }
  current = run && chapterId ? { chapterId, run } : null;
  for (const listener of currentListeners) listener();
}
