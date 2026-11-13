"use client";

import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ChevronRight, FolderOpen, FolderUp, Loader2, Upload } from "lucide-react";
import {
  putSignedUpload,
  useConfirmDocumentUploads,
  useInvalidateDocuments,
  useRequestDocumentUploadUrls,
} from "@repo/hooks";
import { MemberFacingError } from "@repo/hooks/error-copy";
import { MAX_UPLOAD_LABEL } from "@repo/validation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FOCUS_RING } from "@/components/ui/focus";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Panel,
  PanelBody,
  PanelContent,
  PanelFooter,
  PanelHeader,
} from "@/components/shared/panel";
import {
  useGatedDialog,
  type SubscriptionGate,
} from "@/components/shared/subscription-gate";
import {
  dashboardCheckboxHitAreaClassName,
  dashboardTableCheckboxClassName,
} from "@/components/shared/table-controls";
import {
  collectFromDrop,
  collectFromList,
  type CollectedFiles,
} from "@/lib/bulk-upload/collect-files";
import {
  FolderImport,
  duplicateReasons,
  isIncluded,
  type ImportContext,
  type ImportRow,
  type ImportView,
} from "@/lib/documents/folder-import-session";
import { LEFT_OUT_LABEL } from "@/lib/documents/folder-import";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { cn } from "@/lib/utils";

const NONE = "__none__";

/**
 * Import a folder into Documents (#2242; step 4 of the plan in #3642,
 * `spec/behavior/chapter-docs.md` § Folder import). Docked beside Upload
 * document, it takes a dropped or picked folder (or many files), checks them
 * on this device, and shows what it will do before anything uploads:
 *
 * - **Left out**: types Documents doesn't take and files over the cap,
 *   listed and counted, never silently dropped.
 * - **Copies**: the same file twice in the folder, or one that looks like a
 *   document already in Documents. They start unticked; tick one to import it
 *   anyway.
 * - **Everything else, grouped by the folder it will land in**, each file
 *   with a suggested title and type the officer can change. A group's folder
 *   is changed for the whole group at once, the way M-Files and Box review
 *   suggestions in sets rather than one by one.
 *
 * Import then uploads and files them, a few at a time, with progress and a
 * retry for any that fail. Google Drive and Dropbox both keep a dropped
 * folder's structure; Frapp's folders are one level deep, so the structure
 * becomes a suggestion of the Documents folder each file goes into.
 */
export function FolderImportPanel({
  gate,
  context,
}: {
  gate: SubscriptionGate;
  context: ImportContext;
}) {
  const dialog = useGatedDialog(gate);
  const requestUrls = useRequestDocumentUploadUrls();
  const confirmUploads = useConfirmDocumentUploads();
  const invalidate = useInvalidateDocuments();
  const chapterId = useChapterStore((s) => s.activeChapterId);

  // The latest mutations, read when a batch goes out rather than when the
  // import was made.
  const live = useRef({ requestUrls, confirmUploads, chapterId });
  useLayoutEffect(() => {
    live.current = { requestUrls, confirmUploads, chapterId };
  });

  const [run, setRun] = useState<FolderImport | null>(null);
  function start(collected: CollectedFiles) {
    const startedIn = live.current.chapterId;
    const next =
      run ??
      new FolderImport({
        mint: async (files) =>
          (await live.current.requestUrls.mutateAsync({ files })).tickets,
        put: ({ url, file, contentType }) =>
          putSignedUpload({
            signedUrl: url,
            body: file,
            contentType,
            upsert: true,
            describeRejection: () => "The file didn't upload.",
          }),
        confirm: async (documents) =>
          (await live.current.confirmUploads.mutateAsync({ documents }))
            .results,
        assertChapter: () => {
          if (useChapterStore.getState().activeChapterId !== startedIn) {
            throw new MemberFacingError(
              "You switched chapters, so this one wasn't imported.",
            );
          }
        },
      });
    next.add(collected.files, context, collected.unreadable ?? 0);
    setRun(next);
  }

  const view = useSyncExternalStore(
    run?.subscribe ?? noSubscribe,
    run?.getSnapshot ?? emptyView,
    run?.getSnapshot ?? emptyView,
  );

  const pending = view.queue.items.filter(
    (it) => it.status === "waiting" || it.status === "finishing",
  ).length;

  // Refresh the library once an import has nothing left in flight.
  const wasPending = useRef(0);
  useEffect(() => {
    if (wasPending.current > 0 && pending === 0) invalidate();
    wasPending.current = pending;
  }, [pending, invalidate]);

  // The tab is the only copy of what hasn't uploaded yet.
  useEffect(() => {
    if (pending === 0) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  function close() {
    dialog.setOpen(false);
    // A finished or never-started import is cleared; one still uploading
    // keeps going behind the page and is there when the panel reopens.
    if (run && pending === 0) {
      run.discard();
      setRun(null);
    }
  }

  return (
    <>
      <Button
        variant="secondary"
        size="toolbar"
        className="gap-2"
        onClick={() => dialog.setOpen(true)}
        {...gate.controlProps()}
      >
        <FolderUp className="h-4 w-4" /> Import a folder
      </Button>
      <Panel
        open={dialog.dialogProps.open}
        onOpenChange={(next) => (next ? dialog.setOpen(true) : close())}
        docked
        backLabel="Back to documents"
      >
        <PanelContent {...dialog.contentProps} aria-describedby={undefined}>
          <PanelHeader>Import a folder</PanelHeader>
          {view.rows.length === 0 && view.leftOut.length === 0 ? (
            <PanelBody>
              <ImportDropZone onFiles={start} disabled={!gate.allowed} />
            </PanelBody>
          ) : view.applied ? (
            <ImportProgress view={view} run={run!} onDone={close} />
          ) : (
            <ImportReview
              view={view}
              run={run!}
              folders={context.folders}
              typeOptions={context.typeOptions}
              gate={gate}
              onCancel={close}
            />
          )}
        </PanelContent>
      </Panel>
    </>
  );
}

const noSubscribe = () => () => undefined;
const EMPTY_VIEW: ImportView = {
  rows: [],
  leftOut: [],
  unreadable: 0,
  queue: { items: [], currentId: null },
  applied: false,
};
const emptyView = () => EMPTY_VIEW;

/** Takes everything; the check after it says what Documents can't take. */
const keepAll = () => true;

function ImportDropZone({
  onFiles,
  disabled,
}: {
  onFiles: (collected: CollectedFiles) => void;
  disabled: boolean;
}) {
  const [over, setOver] = useState(false);
  const folderInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // `webkitdirectory` isn't in React's attribute types.
    folderInput.current?.setAttribute("webkitdirectory", "");
  }, []);

  function pick(event: React.ChangeEvent<HTMLInputElement>) {
    if (event.target.files?.length) {
      onFiles(collectFromList(Array.from(event.target.files), keepAll));
    }
    event.target.value = "";
  }

  return (
    <div
      data-testid="folder-import-drop"
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        if (disabled) return;
        // Entries are taken before the first await (`collect-files.ts`).
        void collectFromDrop(event.dataTransfer.items, keepAll).then(onFiles, () =>
          onFiles({ files: [], skipped: 0, unreadable: 1 }),
        );
      }}
      className={cn(
        "flex min-h-72 flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-6 text-center transition-colors",
        over ? "border-muted-foreground bg-card-hover" : "border-input bg-surface-1",
      )}
    >
      <FolderUp className="h-6 w-6 text-muted-foreground" aria-hidden />
      <p className="text-label font-semibold">Drop a folder here</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="toolbar"
          className="gap-1.5"
          disabled={disabled}
          onClick={() => folderInput.current?.click()}
        >
          <FolderOpen className="h-4 w-4" aria-hidden /> Choose a folder
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="toolbar"
          className="gap-1.5"
          disabled={disabled}
          onClick={() => filesInput.current?.click()}
        >
          <Upload className="h-4 w-4" aria-hidden /> Choose files
        </Button>
      </div>
      <p className="max-w-xs text-caption text-muted-foreground">
        Nothing uploads until you&apos;ve checked each file&apos;s folder, type
        and title. PDFs, Office files, text, CSV or images, up to{" "}
        {MAX_UPLOAD_LABEL} each.
      </p>
      <input
        ref={folderInput}
        type="file"
        multiple
        hidden
        aria-label="Choose a folder"
        onChange={pick}
      />
      <input
        ref={filesInput}
        type="file"
        multiple
        hidden
        aria-label="Choose files"
        onChange={pick}
      />
    </div>
  );
}

function ImportReview({
  view,
  run,
  folders,
  typeOptions,
  gate,
  onCancel,
}: {
  view: ImportView;
  run: FolderImport;
  folders: readonly string[];
  typeOptions: readonly string[];
  gate: SubscriptionGate;
  onCancel: () => void;
}) {
  const duplicates = useMemo(
    () => duplicateReasons(view.rows, view.queue),
    [view.rows, view.queue],
  );
  const status = useMemo(
    () => new Map(view.queue.items.map((it) => [it.id, it])),
    [view.queue],
  );
  const checking = view.rows.filter((row) => {
    const s = status.get(row.id)?.status;
    return s === "queued" || s === "preparing";
  }).length;
  const unreadable =
    view.unreadable +
    view.rows.filter((row) => status.get(row.id)?.status === "failed").length;
  const copies = view.rows.filter((row) => duplicates.has(row.id));
  const rest = view.rows.filter((row) => !duplicates.has(row.id));
  const toImport = view.rows.filter(
    (row) =>
      status.get(row.id)?.status === "ready" &&
      isIncluded(row, duplicates.get(row.id)),
  ).length;

  const groups = useMemo(() => {
    const byFolder = new Map<string, ImportRow[]>();
    for (const row of rest) {
      const list = byFolder.get(row.folder) ?? [];
      list.push(row);
      byFolder.set(row.folder, list);
    }
    // Named folders A to Z, then the files with none.
    return [...byFolder.entries()].sort(([a], [b]) =>
      a === "" ? 1 : b === "" ? -1 : a.localeCompare(b),
    );
  }, [rest]);
  const allFolders = useMemo(() => {
    const names = new Set(folders);
    for (const row of view.rows) if (row.folder) names.add(row.folder);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [folders, view.rows]);

  return (
    <>
      <PanelBody>
        <p className="text-sm" aria-live="polite">
          {checking > 0
            ? `Checking ${view.rows.length - checking} of ${view.rows.length} files…`
            : `${toImport} ${toImport === 1 ? "file" : "files"} to import`}
          {copies.length > 0 ? `, ${copies.length} possible ${copies.length === 1 ? "copy" : "copies"}` : ""}
          {view.leftOut.length > 0 ? `, ${view.leftOut.length} left out` : ""}
          {unreadable > 0 ? `, ${unreadable} couldn't be read` : ""}
        </p>

        {view.leftOut.length > 0 ? (
          <Disclosure label={`Left out (${view.leftOut.length})`}>
            <ul className="grid gap-1 text-caption text-muted-foreground">
              {view.leftOut.map((item) => (
                <li key={item.path} className="flex min-w-0 justify-between gap-3">
                  <span className="truncate">{item.path}</span>
                  <span className="shrink-0">{LEFT_OUT_LABEL[item.reason]}</span>
                </li>
              ))}
            </ul>
          </Disclosure>
        ) : null}

        {copies.length > 0 ? (
          <section className="grid gap-2" aria-label="Possible copies">
            <h3 className="text-label font-semibold">Possible copies</h3>
            <p className="text-caption text-muted-foreground">
              Left out unless you tick them.
            </p>
            <ul className="grid gap-1">
              {copies.map((row) => (
                <FileRow
                  key={row.id}
                  row={row}
                  included={isIncluded(row, duplicates.get(row.id))}
                  note={
                    duplicates.get(row.id) === "in-import"
                      ? "The same file is already in this import"
                      : `Looks like “${row.inLibrary}” in Documents`
                  }
                  run={run}
                  typeOptions={typeOptions}
                  ready={status.get(row.id)?.status === "ready"}
                />
              ))}
            </ul>
          </section>
        ) : null}

        {groups.map(([folder, rows]) => (
          <section
            key={folder || NONE}
            className="grid gap-2"
            aria-label={folder ? `Folder ${folder}` : "No folder"}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex min-w-0 items-center gap-2 text-label font-semibold">
                <span className="truncate">{folder || "No folder"}</span>
                {folder && !folders.includes(folder) ? (
                  <Badge variant="outline">New folder</Badge>
                ) : null}
                <span className="font-normal text-muted-foreground">
                  {rows.length}
                </span>
              </h3>
              <Select
                value={folder || NONE}
                onValueChange={(value) =>
                  run.moveGroup(folder, value === NONE ? "" : value)
                }
              >
                <SelectTrigger
                  className="h-8 w-auto min-w-36 text-sm"
                  aria-label={`Move ${folder || "unfiled files"} to`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No folder</SelectItem>
                  {allFolders.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ul className="grid gap-1">
              {rows.map((row) => (
                <FileRow
                  key={row.id}
                  row={row}
                  included={isIncluded(row, undefined)}
                  note={
                    row.suggestion.typeUnknown && row.documentType === ""
                      ? "No type suggested"
                      : undefined
                  }
                  run={run}
                  typeOptions={typeOptions}
                  ready={status.get(row.id)?.status === "ready"}
                />
              ))}
            </ul>
          </section>
        ))}
      </PanelBody>
      <PanelFooter>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          onClick={() => run.apply()}
          {...gate.controlProps(checking > 0 || toImport === 0)}
        >
          {checking > 0 ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Import {toImport} {toImport === 1 ? "file" : "files"}
        </Button>
      </PanelFooter>
    </>
  );
}

function FileRow({
  row,
  included,
  note,
  run,
  typeOptions,
  ready,
}: {
  row: ImportRow;
  included: boolean;
  note?: string;
  run: FolderImport;
  typeOptions: readonly string[];
  ready: boolean;
}) {
  const types =
    row.documentType && !typeOptions.includes(row.documentType)
      ? [...typeOptions, row.documentType]
      : typeOptions;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 gap-y-1 rounded-md py-1.5">
      <label className={cn(dashboardCheckboxHitAreaClassName, "mt-2")}>
        <input
          type="checkbox"
          className={dashboardTableCheckboxClassName}
          checked={included}
          disabled={!ready}
          aria-label={`Import ${row.path}`}
          onChange={(event) =>
            run.update(row.id, { include: event.target.checked })
          }
        />
      </label>
      <div className={cn("grid min-w-0 gap-1", !included && "opacity-60")}>
        <div className="grid grid-cols-[minmax(0,1fr)_9rem] gap-2">
          <Input
            aria-label={`Title for ${row.path}`}
            className="h-8 text-sm"
            value={row.title}
            maxLength={255}
            onChange={(event) => run.update(row.id, { title: event.target.value })}
          />
          <Select
            value={row.documentType || NONE}
            onValueChange={(value) =>
              run.update(row.id, { documentType: value === NONE ? "" : value })
            }
          >
            <SelectTrigger
              className="h-8 text-sm"
              aria-label={`Type for ${row.path}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No type</SelectItem>
              {types.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="truncate text-caption text-muted-foreground" title={row.path}>
          {row.path}
          {note ? ` · ${note}` : ""}
        </p>
      </div>
    </li>
  );
}

function ImportProgress({
  view,
  run,
  onDone,
}: {
  view: ImportView;
  run: FolderImport;
  onDone: () => void;
}) {
  const items = view.queue.items;
  const done = items.filter((it) => it.status === "done").length;
  const failed = items.filter((it) => it.status === "failed");
  const total = items.length;
  const finished = done + failed.length === total;
  const pathOf = new Map(view.rows.map((row) => [row.id, row.path]));

  return (
    <>
      <PanelBody>
        <p className="text-sm font-semibold" aria-live="polite">
          {finished
            ? `Imported ${done} of ${total} ${total === 1 ? "file" : "files"}`
            : `Importing ${done} of ${total}…`}
        </p>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-input"
          role="progressbar"
          aria-label="Import progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
        >
          <div
            className="h-full bg-accent transition-[width]"
            style={{ width: `${total ? (done / total) * 100 : 0}%` }}
          />
        </div>
        {!finished ? (
          <p className="text-caption text-muted-foreground">
            Keep this tab open until it finishes. You can go back to Documents
            meanwhile.
          </p>
        ) : null}
        {failed.length > 0 ? (
          <section className="grid gap-2" aria-label="Didn't import">
            <h3 className="text-label font-semibold">
              Didn&apos;t import ({failed.length})
            </h3>
            <ul className="grid gap-1">
              {failed.map((item) => (
                <li
                  key={item.id}
                  className="flex min-w-0 items-center justify-between gap-3 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block truncate">{pathOf.get(item.id)}</span>
                    <span className="block text-caption text-destructive-text">
                      {item.error}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => run.retry(item.id)}
                  >
                    Retry
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </PanelBody>
      <PanelFooter>
        {failed.length > 1 ? (
          <Button variant="secondary" onClick={() => run.retryFailed()}>
            Retry all
          </Button>
        ) : null}
        <Button onClick={onDone}>{finished ? "Done" : "Hide"}</Button>
      </PanelFooter>
    </>
  );
}

function Disclosure({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="grid gap-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-fit items-center gap-1 rounded-sm text-label font-semibold text-muted-foreground hover:text-foreground",
          FOCUS_RING,
        )}
      >
        <ChevronRight
          aria-hidden
          className={cn("h-4 w-4 transition-transform", open && "rotate-90")}
        />
        {label}
      </button>
      {open ? children : null}
    </div>
  );
}
