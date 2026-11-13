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
import { statusOf } from "@repo/api-sdk";
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
  assertChapter: () => void;
  sleep?: (ms: number) => Promise<void>;
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

/** Uploads in flight at once; their links and filing go in shared batches. */
const MAX_FINISHING = 6;
/** Files hashed at once, so only these are ever read into memory. */
const MAX_HASHING = 2;
/** Waits before retrying a batch the API refused with 429, as backwork's. */
const RATE_LIMIT_WAITS_MS = [15_000, 30_000, 45_000];

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export class FolderImport {
  private rows: ImportRow[] = [];
  private leftOut: LeftOut[] = [];
  private unreadable = 0;
  private applied = false;
  private view: ImportView;
  private listeners = new Set<() => void>();
  readonly queue: BulkUploadQueue<Prepared, Submission>;

  constructor(private readonly deps: ImportDeps) {
    const sleep = deps.sleep ?? realSleep;
    const patiently =
      <In, Out>(run: (items: In[]) => Promise<Out[]>) =>
      async (items: In[]) => {
        for (let attempt = 0; ; attempt += 1) {
          deps.assertChapter();
          try {
            return await run(items);
          } catch (error) {
            const wait = RATE_LIMIT_WAITS_MS[attempt];
            if (statusOf(error) !== 429 || wait === undefined) throw error;
            await sleep(wait);
          }
        }
      };
    const mint = createBatcher(patiently(deps.mint));
    const confirm = createBatcher(patiently(deps.confirm));

    this.queue = new BulkUploadQueue<Prepared, Submission>({
      lookahead: Number.POSITIVE_INFINITY,
      maxPreparing: MAX_HASHING,
      maxFinishing: MAX_FINISHING,
      prepare: async (file) => ({
        hash: await sha256Hex(new Uint8Array(await file.arrayBuffer())),
      }),
      finish: async ({ file, submission }) => {
        const ticket = await mint.add({
          filename: file.name,
          content_type: submission.contentType,
          size_bytes: file.size,
        });
        await deps.put({
          url: ticket.upload_url,
          file,
          contentType: submission.contentType,
        });
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
            : "This one didn't upload. Retry it.",
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
    for (const file of files) {
      const path = relativePath(file);
      const checked = checkImportFile(file);
      if (!checked.ok) {
        this.leftOut.push({ path, reason: checked.reason });
        continue;
      }
      kept.push(file);
      const suggestion = suggestForImport(path, context);
      this.rows.push({
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
    const added = this.queue
      .getSnapshot()
      .items.filter((it) => !before.has(it.id));
    for (const item of added) {
      const row = this.rows.find((r) => r.file === item.file && r.id === "");
      if (row) row.id = item.id;
    }
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

  /** Sends every kept, checked file on to upload and filing. */
  apply(): number {
    let sent = 0;
    const items = new Map(
      this.queue.getSnapshot().items.map((it) => [it.id, it]),
    );
    const duplicates = duplicateReasons(this.rows, this.view.queue);
    for (const row of this.rows) {
      const item = items.get(row.id);
      if (!item || item.status !== "ready") continue;
      if (!isIncluded(row, duplicates.get(row.id))) {
        this.queue.remove(row.id);
        continue;
      }
      this.queue.submit(row.id, {
        title: row.title.trim() || row.suggestion.title,
        documentType: row.documentType.trim(),
        folder: row.folder.trim(),
        contentType: row.contentType,
      });
      sent += 1;
    }
    this.applied = true;
    this.publish();
    return sent;
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
    this.rows = [];
    this.leftOut = [];
    this.unreadable = 0;
    this.applied = false;
    this.publish();
  }

  private publish(): void {
    this.view = this.build();
    for (const listener of this.listeners) listener();
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
