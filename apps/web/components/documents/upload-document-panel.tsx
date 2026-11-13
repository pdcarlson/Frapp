"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Loader2, Upload } from "lucide-react";
import {
  putSignedUpload,
  useConfirmDocumentUpload,
  useRequestDocumentUploadUrl,
  type DocumentTypeRow,
} from "@repo/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { FOCUS_RING } from "@/components/ui/focus";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  UPLOAD_FIELD_CLASS,
  UPLOAD_SHEET_BUTTON_CLASS,
  UploadField,
  UploadFileField,
} from "@/components/shared/upload-sheet";
import {
  useGatedDialog,
  type SubscriptionGate,
} from "@/components/shared/subscription-gate";
import { DocumentTypesEditor } from "@/components/documents/document-types-editor";
import { useToast } from "@/lib/hooks/use-toast";
import { cn, getErrorMessage } from "@/lib/utils";
import {
  guessDocumentType,
  suggestFolder,
  titleFromFilename,
} from "@/lib/documents/upload-defaults";
import {
  DOCUMENT_TYPE_NAME_MAX_LENGTH,
  DOCUMENT_TYPES_MAX,
  MAX_UPLOAD_LABEL,
  acceptAttribute,
  inspectUploadFile,
  readSignedUpload,
} from "@repo/validation";

/*
  The signed-URL flow blocks SVG + executables. Kind `document` in
  `@repo/validation` is shared with Backwork and chat so the three cannot drift.

  Each string names the verdict, because it is the whole inline error under the
  file field rather than a toast body under a title that named it.
*/
function uploadRejectionDescription(reason: "type" | "size"): string {
  if (reason === "size") {
    return `That file is too large. Chapter documents accept files up to ${MAX_UPLOAD_LABEL}.`;
  }
  return "That file type is not allowed. Chapter documents accept PDFs, Office files, text, CSV, and common images (no SVG).";
}

type UploadDraft = {
  title: string;
  description: string;
  folder: string;
  documentType: string;
  effectiveDate: string;
  file: File | null;
  /*
    Whether each guessable field still holds what the panel put there (or
    nothing). Choosing another file replaces a guess but never something the
    officer typed or picked. Kept in the draft, not a ref, so the updaters
    below stay pure.
  */
  autoTitle: boolean;
  autoType: boolean;
  autoFolder: boolean;
};

const EMPTY_UPLOAD_DRAFT: UploadDraft = {
  title: "",
  description: "",
  folder: "",
  documentType: "",
  effectiveDate: "",
  file: null,
  autoTitle: true,
  autoType: true,
  autoFolder: true,
};

/** The draft fields an officer edits by hand; editing one ends its guessing. */
type EditableField = Exclude<
  keyof UploadDraft,
  "file" | "autoTitle" | "autoType" | "autoFolder"
>;

/**
 * The upload panel's state and submit. The page calls this rather than the
 * panel, so the draft stays on the page: the panel renders inside a `Can`, and
 * state owned by a gated child would go whenever the gate unmounts it.
 *
 * `activeFolder` is the folder the officer is looking at, which a fresh draft
 * files into; `typeOptions` are the chips, which the file name's guess is
 * matched against; `folders` and `documents` say where the guessed type is
 * usually filed, for a draft started from "All files".
 */
export function useDocumentUpload(
  gate: SubscriptionGate,
  {
    activeFolder,
    typeOptions,
    folders,
    documents,
  }: {
    activeFolder: string | null;
    typeOptions: readonly string[];
    folders: readonly string[];
    documents: ReadonlyArray<{
      document_type: string | null;
      folder: string | null;
    }>;
  },
) {
  const { toast } = useToast();
  const requestUpload = useRequestDocumentUploadUrl();
  const confirmUpload = useConfirmDocumentUpload();
  const uploadDialog = useGatedDialog(gate);
  const [uploadDraft, setUploadDraft] =
    useState<UploadDraft>(EMPTY_UPLOAD_DRAFT);
  const [uploading, setUploading] = useState(false);
  /** Bumped when an upload lands and the draft starts over. */
  const [draftGeneration, setDraftGeneration] = useState(0);
  /*
    The panel's one inline error, held here because `handleUpload` is what
    discovers it: the file is inspected on submit, against `@repo/validation`'s
    shared allowlist.
  */
  const [uploadError, setUploadError] = useState<string | null>(null);
  const chooseFile = useCallback(
    (file: File | null) => {
      setUploadError(null);
      setUploadDraft((prev) => {
        if (!file) return { ...prev, file };
        const next = { ...prev, file };
        if (prev.autoTitle) next.title = titleFromFilename(file.name);
        if (prev.autoType) {
          next.documentType = guessDocumentType(file.name, typeOptions) ?? "";
        }
        if (prev.autoFolder) {
          next.folder = next.documentType
            ? (suggestFolder(next.documentType, folders, documents) ?? "")
            : "";
        }
        return next;
      });
    },
    [typeOptions, folders, documents],
  );

  /**
   * An edit by hand: sets the field and stops guessing it. Correcting the type
   * re-guesses a folder the officer has not picked, so a wrong first guess
   * does not leave the file in the wrong type's folder.
   */
  const editField = useCallback(
    <K extends EditableField>(key: K, value: UploadDraft[K]) =>
      setUploadDraft((prev) => {
        const next = { ...prev, [key]: value };
        if (key === "title") next.autoTitle = false;
        if (key === "folder") next.autoFolder = false;
        if (key === "documentType") {
          next.autoType = false;
          if (prev.autoFolder) {
            next.folder = next.documentType
              ? (suggestFolder(next.documentType, folders, documents) ?? "")
              : "";
          }
        }
        return next;
      }),
    [folders, documents],
  );

  /*
    Every way into the panel goes through here: the toolbar button and a file
    dropped on the page. A draft whose folder nobody has picked files into the
    folder on screen, and a spent rejection from the last attempt is cleared.
    A folder picked by hand is kept, like the rest of the draft.
  */
  const openPanel = useCallback(
    (file?: File) => {
      setUploadError(null);
      // A folder on screen is a choice the officer already made, so it is
      // not guessed over; from "All files" or "No folder" the type decides.
      setUploadDraft((prev) =>
        prev.file || !prev.autoFolder
          ? prev
          : { ...prev, folder: activeFolder || "", autoFolder: !activeFolder },
      );
      if (file) chooseFile(file);
      uploadDialog.setOpen(true);
    },
    [activeFolder, chooseFile, uploadDialog],
  );

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    /*
      Both rejections are inline on the file field, not a toast (board `1j`:
      "errors inline on touched fields"). The upload failures further down
      stay toasts: they happened elsewhere, the network or the bucket.
    */
    const file = uploadDraft.file;
    if (!file) {
      setUploadError("Choose a file to upload.");
      return;
    }
    const inspected = inspectUploadFile("document", file);
    if (!inspected.ok) {
      setUploadError(uploadRejectionDescription(inspected.reason));
      return;
    }
    setUploadError(null);
    const contentType = inspected.contentType;
    setUploading(true);
    try {
      const signed = await requestUpload.mutateAsync({
        filename: file.name,
        content_type: contentType,
      });
      const { signedUrl, storagePath } = readSignedUpload(signed);

      await putSignedUpload({
        signedUrl,
        body: file,
        contentType,
        upsert: true,
        describeRejection: () =>
          "The file didn't upload. Check its size and try again.",
      });

      await confirmUpload.mutateAsync({
        storage_path: storagePath,
        title: uploadDraft.title.trim() || titleFromFilename(file.name),
        description: uploadDraft.description.trim() || undefined,
        folder: uploadDraft.folder.trim() || undefined,
        content_type: contentType,
        byte_size: file.size,
        document_type: uploadDraft.documentType.trim() || undefined,
        effective_date: uploadDraft.effectiveDate || undefined,
      });
      const folder = uploadDraft.folder.trim();
      toast({
        title: "Document uploaded",
        description: folder
          ? `${file.name} is now in ${folder}.`
          : `${file.name} is now in the chapter library.`,
      });
      uploadDialog.setOpen(false);
      setUploadDraft(EMPTY_UPLOAD_DRAFT);
      setDraftGeneration((n) => n + 1);
    } catch (error) {
      toast({
        title: "Couldn't upload document",
        description: getErrorMessage(error, "Try the upload again."),
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

  return {
    uploadDialog,
    uploadDraft,
    editField,
    uploading,
    uploadError,
    chooseFile,
    openPanel,
    handleUpload,
    draftGeneration,
  };
}

export type DocumentUpload = ReturnType<typeof useDocumentUpload>;

/** Radix `Select` items cannot carry `""`, so these stand in for the two non-folders. */
const NO_FOLDER = "__no-folder__";
const NEW_FOLDER = "__new-folder__";

/**
 * The chapter document upload panel (2026-11-06 rethink; parked follow-ups in
 * #3642). A `Panel` docked in place of the Documents page (2026-11-12, #4593),
 * like the event editor and the Directory's member profile, led
 * by the file well, which also takes a dropped file. Picking a file fills the
 * title from its name, guesses the type from it, and files it into the folder
 * on screen. Type is a row of chips over the chapter's own list of types
 * (#3642), and folder a picker of the chapter's folders, where both used to be
 * free text that let "Bylaws", "bylaws" and "By-laws" pile up as three. Description and effective date wait behind one
 * line, because most uploads never set them.
 */
export function UploadDocumentPanel({
  gate,
  upload,
  folders,
  typeOptions,
  typeRows = null,
}: {
  gate: SubscriptionGate;
  upload: DocumentUpload;
  folders: readonly string[];
  typeOptions: readonly string[];
  /**
   * The chapter's types, for "Edit types"; null hides it (no
   * `chapter_docs:manage`, or the list hasn't loaded).
   */
  typeRows?: readonly DocumentTypeRow[] | null;
}) {
  const {
    uploadDialog,
    uploadDraft,
    editField: set,
    uploading,
    uploadError,
    chooseFile,
    openPanel,
    handleUpload,
  } = upload;

  const folderIsNew =
    uploadDraft.folder !== "" && !folders.includes(uploadDraft.folder);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const showNewFolder = newFolderOpen || folderIsNew;

  const typeIsCustom =
    uploadDraft.documentType !== "" &&
    !typeOptions.includes(uploadDraft.documentType);
  const [customTypeOpen, setCustomTypeOpen] = useState(false);
  const showCustomType = customTypeOpen || typeIsCustom;
  /*
    A type picked from the chips that then left the list (renamed or deleted
    in Edit types) is not a new type to add back: let it go. One typed under
    New type stays, since that is the officer's own.
  */
  const staleType =
    typeIsCustom && !customTypeOpen ? uploadDraft.documentType : null;
  useEffect(() => {
    if (staleType !== null) set("documentType", "");
  }, [staleType, set]);
  const atTypeCap = typeOptions.length >= DOCUMENT_TYPES_MAX;

  const hasDetails =
    uploadDraft.description !== "" || uploadDraft.effectiveDate !== "";
  const [detailsOpen, setDetailsOpen] = useState(false);
  const showDetails = detailsOpen || hasDetails;

  /*
    A finished upload starts a new draft; fold the optional rows back with it.
    Adjusted during render (React's "storing information from previous
    renders"), not in an effect, so the next open never paints the old rows.
  */
  const [seenDraft, setSeenDraft] = useState(upload.draftGeneration);
  if (seenDraft !== upload.draftGeneration) {
    setSeenDraft(upload.draftGeneration);
    setNewFolderOpen(false);
    setCustomTypeOpen(false);
    setDetailsOpen(false);
  }

  const folderValue = showNewFolder
    ? NEW_FOLDER
    : uploadDraft.folder === ""
      ? NO_FOLDER
      : uploadDraft.folder;

  return (
    <>
      <Button
        size="toolbar"
        className="gap-2"
        onClick={() => openPanel()}
        {...gate.controlProps()}
      >
        <Upload className="h-4 w-4" /> Upload document
      </Button>
      <Panel
        open={uploadDialog.dialogProps.open}
        onOpenChange={(next) => {
          if (next) {
            openPanel();
            return;
          }
          uploadDialog.dialogProps.onOpenChange(false);
        }}
        docked
        backLabel="Back to documents"
      >
        <PanelContent
          {...uploadDialog.contentProps}
          aria-describedby={undefined}
        >
          <PanelHeader>Upload document</PanelHeader>
          <PanelBody as="form" id="doc-upload-form" onSubmit={handleUpload}>
            <UploadFileField
              id="doc-file"
              label="File"
              hint={`PDFs, Office files, text, CSV or images, up to ${MAX_UPLOAD_LABEL}.`}
              accept={acceptAttribute("document")}
              file={uploadDraft.file}
              error={uploadError}
              disabled={uploading}
              onSelect={chooseFile}
            />

            <UploadField id="doc-title" label="Title">
              <Input
                id="doc-title"
                className={UPLOAD_FIELD_CLASS}
                value={uploadDraft.title}
                onChange={(event) => set("title", event.target.value)}
                placeholder="Filled in from the file name"
              />
            </UploadField>

            <div className="grid content-start gap-1.5">
              <Label id="doc-type-label">Type</Label>
              <div
                role="group"
                aria-labelledby="doc-type-label"
                className="flex flex-wrap gap-1.5"
              >
                {typeOptions.map((type) => {
                  const on =
                    !showCustomType && uploadDraft.documentType === type;
                  return (
                    <TypeChip
                      key={type}
                      on={on}
                      onClick={() => {
                        setCustomTypeOpen(false);
                        set("documentType", on ? "" : type);
                      }}
                    >
                      {type}
                    </TypeChip>
                  );
                })}
                {atTypeCap && !showCustomType ? null : (
                  <TypeChip
                    on={showCustomType}
                    onClick={() => {
                      if (showCustomType) {
                        setCustomTypeOpen(false);
                        set("documentType", "");
                      } else {
                        setCustomTypeOpen(true);
                        set("documentType", "");
                      }
                    }}
                  >
                    New type
                  </TypeChip>
                )}
                {typeRows ? (
                  <DocumentTypesEditor
                    types={typeRows}
                    disabled={uploading}
                    chipClassName={TYPE_CHIP_CLASS}
                  />
                ) : null}
              </div>
              {showCustomType ? (
                <Input
                  id="doc-type-other"
                  aria-label="New type name"
                  autoFocus={customTypeOpen && !typeIsCustom}
                  className={UPLOAD_FIELD_CLASS}
                  value={uploadDraft.documentType}
                  onChange={(event) => set("documentType", event.target.value)}
                  placeholder="Constitution, Contract, Schedule"
                  maxLength={DOCUMENT_TYPE_NAME_MAX_LENGTH}
                />
              ) : null}
              {showCustomType ? (
                <p className="text-caption text-muted-foreground">
                  Uploading adds it to the chapter&apos;s types.
                </p>
              ) : null}
            </div>

            <UploadField id="doc-folder" label="Folder">
              <Select
                value={folderValue}
                onValueChange={(value) => {
                  if (value === NEW_FOLDER) {
                    setNewFolderOpen(true);
                    set("folder", "");
                    return;
                  }
                  setNewFolderOpen(false);
                  set("folder", value === NO_FOLDER ? "" : value);
                }}
              >
                <SelectTrigger id="doc-folder" className={UPLOAD_FIELD_CLASS}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_FOLDER}>No folder</SelectItem>
                  {folders.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                  <SelectItem value={NEW_FOLDER}>New folder</SelectItem>
                </SelectContent>
              </Select>
              {showNewFolder ? (
                <Input
                  id="doc-folder-new"
                  aria-label="New folder name"
                  autoFocus={newFolderOpen && !folderIsNew}
                  className={cn(UPLOAD_FIELD_CLASS, "mt-1.5")}
                  value={uploadDraft.folder}
                  onChange={(event) => set("folder", event.target.value)}
                  placeholder="Folder name"
                  maxLength={100}
                />
              ) : null}
            </UploadField>

            {showDetails ? (
              <>
                <UploadField id="doc-description" label="Description">
                  <Textarea
                    id="doc-description"
                    rows={2}
                    value={uploadDraft.description}
                    onChange={(event) => set("description", event.target.value)}
                  />
                </UploadField>
                <UploadField id="doc-effective-date" label="Effective date">
                  <DateField
                    id="doc-effective-date"
                    lean="back"
                    placeholder="e.g. September 1"
                    className={cn(UPLOAD_FIELD_CLASS, "w-48")}
                    value={uploadDraft.effectiveDate}
                    onChange={(date) => set("effectiveDate", date)}
                  />
                </UploadField>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setDetailsOpen(true)}
                className={cn(
                  "flex w-fit items-center gap-1 rounded-sm text-label font-semibold text-muted-foreground hover:text-foreground",
                  FOCUS_RING,
                )}
              >
                <ChevronRight aria-hidden className="h-4 w-4" />
                Add a description or effective date
              </button>
            )}
          </PanelBody>
          <PanelFooter>
            {/* Cancel only closes. Gating the way out of a surface the gate just
              blocked would be a trap. */}
            <Button
              variant="secondary"
              className={UPLOAD_SHEET_BUTTON_CLASS}
              onClick={() => uploadDialog.setOpen(false)}
              disabled={uploading}
            >
              Cancel
            </Button>
            {/* Enabled with no file chosen (board `1j`): the press answers inline
              under the file field. The subscription gate still disables it. */}
            <Button
              form="doc-upload-form"
              type="submit"
              className={UPLOAD_SHEET_BUTTON_CLASS}
              {...gate.controlProps(uploading)}
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Upload
            </Button>
          </PanelFooter>
        </PanelContent>
      </Panel>
    </>
  );
}

/**
 * The find dialog's filter chip, one step taller to sit with the panel's
 * fields. "Edit types" wears it too, so it sits in the row as a chip.
 */
const TYPE_CHIP_CLASS = cn(
  "inline-flex h-8 items-center rounded-full border px-3 text-sm transition-colors pointer-coarse:h-10",
  FOCUS_RING,
);

function TypeChip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        TYPE_CHIP_CLASS,
        on
          ? "border-transparent bg-accent-subtle font-semibold text-accent-text"
          : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Drop a file anywhere on the Documents page to upload it: a full-window
 * target while a file is dragged over, which opens the panel with the file.
 * Mounted inside the page's `Can permission="chapter_docs:upload"`, so a member
 * who can't upload never sees it. Quiet whenever the panel could not open
 * (`gate.allowed`: a lapsed subscription, offline, or the chapter still
 * loading, where the toolbar button already says why) and while an upload is
 * in flight, so a drop never swaps the file under a running upload.
 *
 * Listens on `window` rather than wrapping the page, so a drop on the rail,
 * the toolbar or empty space all count. A drop the panel's own file well
 * already took (`defaultPrevented`) is left alone.
 */
export function DocumentsPageDropTarget({
  gate,
  upload,
  activeFolder,
}: {
  gate: SubscriptionGate;
  upload: DocumentUpload;
  activeFolder: string | null;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const allowed = gate.allowed && !upload.uploading;
  const panelOpen = upload.uploadDialog.dialogProps.open;
  // Read through a ref so a re-render (the overlay itself causes one) does not
  // tear the listeners down mid-drag and lose the enter/leave count.
  const openPanel = useRef(upload.openPanel);
  useEffect(() => {
    openPanel.current = upload.openPanel;
  }, [upload.openPanel]);

  useEffect(() => {
    if (!allowed) return;
    const carriesFiles = (event: DragEvent) =>
      !!event.dataTransfer && [...event.dataTransfer.types].includes("Files");

    function onEnter(event: DragEvent) {
      if (!carriesFiles(event)) return;
      depth.current += 1;
      if (!panelOpen) setOver(true);
    }
    function onLeave(event: DragEvent) {
      if (!carriesFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    }
    function onOver(event: DragEvent) {
      if (!carriesFiles(event)) return;
      // Without this the browser opens the file in place of the app.
      event.preventDefault();
    }
    function onDrop(event: DragEvent) {
      if (!carriesFiles(event)) return;
      depth.current = 0;
      setOver(false);
      if (event.defaultPrevented) return;
      event.preventDefault();
      const file = event.dataTransfer?.files?.[0];
      if (file) openPanel.current(file);
    }

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
      depth.current = 0;
    };
  }, [allowed, panelOpen]);

  if (!over || !allowed || panelOpen) return null;
  // Where the drop will land: a kept or hand-picked folder wins over the one
  // on screen, as `openPanel` decides.
  const draft = upload.uploadDraft;
  const target = draft.file || !draft.autoFolder ? draft.folder : activeFolder;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-background/70"
    >
      <div className="rounded-xl border-2 border-dashed border-muted-foreground bg-popover px-8 py-6 text-center">
        <p className="text-label font-semibold text-foreground">
          {target ? `Drop to upload to ${target}` : "Drop to upload"}
        </p>
        <p className="mt-1 text-caption text-muted-foreground">
          Opens the upload panel with this file
        </p>
      </div>
    </div>
  );
}
