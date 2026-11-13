"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, Link2, Loader2, X } from "lucide-react";
import {
  MemberFacingError,
  putSignedUpload,
  useRequestTaskPhotoUploadUrl,
  useTaskPhotoUrl,
  withReasonChip,
  type LiveTaskPhoto,
} from "@repo/hooks";
import {
  MAX_UPLOAD_LABEL,
  TASK_COMPLETION_NOTE_MAX,
  TASK_PHOTOS_MAX,
  TASK_PROOF_KIND_LABELS,
  TASK_PROOF_KINDS,
  TASK_SEND_BACK_REASON_MAX,
  acceptAttribute,
  inspectUploadFile,
  normalizeProofLink,
  proofLinkDomain,
  readSignedUpload,
  type TaskProofKind,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedChoice } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/shared/short-form";
import { MediaViewer } from "@/components/shared/media-viewer";
import { cn, getErrorMessage } from "@/lib/utils";

/**
 * Task photos and proof on web (#4565, #4635; `spec/behavior/tasks.md`
 * § Photos): the service-hours proof flow, photos only. A photo is checked
 * here for type and size, uploaded to a signed URL the API mints under the
 * chapter's `tasks/` prefix, and its `storage_path` sent with the write that
 * attaches it. A task carries up to 6 reference photos and a completion up to
 * 6 proof photos, or a link.
 */

export const TASK_PHOTO_HINT = `JPEG, PNG, GIF or WebP photos, up to ${MAX_UPLOAD_LABEL} each.`;

/** Why a picked file can't be a task photo, or null when it can. */
export function taskPhotoProblem(file: File): string | null {
  const inspected = inspectUploadFile("task_photo", file);
  if (inspected.ok) return null;
  return inspected.reason === "size"
    ? `That photo is over ${MAX_UPLOAD_LABEL}.`
    : "Use a JPEG, PNG, GIF or WebP photo.";
}

/** The first problem with a set of picked photos, or null. */
export function taskPhotosProblem(files: File[], max = TASK_PHOTOS_MAX) {
  if (files.length > max) return `Up to ${TASK_PHOTOS_MAX} photos.`;
  for (const file of files) {
    const problem = taskPhotoProblem(file);
    if (problem) return problem;
  }
  return null;
}

/**
 * What to say when a photo didn't upload: the API's own sentence for a
 * refused upload URL (a 400 or 429 arrives as the parsed body, not an
 * `Error`), the client's for a refused file, else a plain retry line.
 */
export function uploadFailureMessage(error: unknown): string {
  // The upload-URL route's refusals are written for members ("File exceeds
  // the 25 MB upload limit"), so they may reach the screen.
  return getErrorMessage(error, "The photo didn't upload. Try again.", {
    serverWritesForMembers: true,
  });
}

/**
 * Upload photos and resolve their `storage_path`s, in order. Rejects with a
 * sentence to show when a file is refused or an upload fails.
 */
export function useUploadTaskPhotos() {
  const requestUrl = useRequestTaskPhotoUploadUrl();
  return async (files: File[]): Promise<string[]> => {
    const paths: string[] = [];
    for (const file of files) {
      const inspected = inspectUploadFile("task_photo", file);
      if (!inspected.ok) {
        throw new MemberFacingError(taskPhotoProblem(file) ?? TASK_PHOTO_HINT);
      }
      const signed = await requestUrl.mutateAsync({
        filename: file.name,
        content_type: inspected.contentType,
        size_bytes: file.size,
      });
      const { signedUrl, storagePath } = readSignedUpload(signed);
      await putSignedUpload({
        signedUrl,
        body: file,
        contentType: inspected.contentType,
        upsert: true,
        describeRejection: () => `The photo didn't upload. ${TASK_PHOTO_HINT}`,
      });
      paths.push(storagePath);
    }
    return paths;
  };
}

/** One stored photo's image, or nothing while its link loads. */
function StoredPhoto({
  taskId,
  photoId,
  className,
}: {
  taskId: string;
  photoId: string;
  className?: string;
}) {
  const url = useTaskPhotoUrl(taskId, photoId);
  if (!url.data) {
    return <span className={cn("block bg-muted/40", className)} aria-hidden />;
  }
  // A signed URL on the storage origin, not a Next image asset.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url.data} alt="" className={className} />;
}

/**
 * A full-size viewer over a set of a task's photos, in the shared
 * `MediaViewer` chat images and documents open in: the arrows and the arrow
 * keys page through the set, the way Google Photos and an Asana attachment
 * preview do.
 */
export function TaskPhotoViewer({
  taskId,
  photos,
  index,
  label,
  onIndexChange,
  onClose,
}: {
  taskId: string;
  photos: LiveTaskPhoto[];
  index: number | null;
  label: string;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const open = index !== null && photos.length > 0;
  const at = Math.min(index ?? 0, Math.max(photos.length - 1, 0));
  const photo = photos[at];
  return (
    <MediaViewer
      open={open}
      onClose={onClose}
      label={label}
      description={photos.length > 1 ? "" : `${label}, one photo.`}
      step={{
        index: at,
        total: photos.length,
        noun: "photo",
        // Stepping wraps, as chat's image viewer does.
        onStep: (delta) =>
          onIndexChange((at + delta + photos.length) % photos.length),
      }}
    >
      {photo ? (
        <StoredPhoto
          key={photo.id}
          taskId={taskId}
          photoId={photo.id}
          className="max-h-full max-w-full object-contain"
        />
      ) : null}
    </MediaViewer>
  );
}

/**
 * A row of a task's photos as small thumbnails, each opening the viewer on
 * itself. Nothing when there are none.
 */
export function TaskPhotoStrip({
  taskId,
  photos,
  label,
}: {
  taskId: string;
  photos: LiveTaskPhoto[];
  /** What the photos are ("Photos", "Proof"): the caption and the viewer's title. */
  label: string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  if (photos.length === 0) return null;
  return (
    <div className="grid gap-1">
      <span className="text-caption text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-2">
        {photos.map((photo, i) => (
          <button
            key={photo.id}
            type="button"
            className="rounded-[10px] hover:opacity-90"
            aria-label={`${label}, photo ${i + 1} of ${photos.length}, opens full size`}
            onClick={() => setOpen(i)}
          >
            <StoredPhoto
              taskId={taskId}
              photoId={photo.id}
              className="h-14 w-14 rounded-[10px] border border-border object-cover"
            />
          </button>
        ))}
      </div>
      <TaskPhotoViewer
        taskId={taskId}
        photos={photos}
        index={open}
        label={label}
        onIndexChange={setOpen}
        onClose={() => setOpen(null)}
      />
    </div>
  );
}

/**
 * Proof as big as the review allows (#4693): one photo across the panel's
 * width, several in two columns, each opening the full-size viewer. The
 * review judges the work, so it gets more room than the card's thumbnails.
 */
export function TaskProofGallery({
  taskId,
  photos,
  label,
}: {
  taskId: string;
  photos: LiveTaskPhoto[];
  label: string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  if (photos.length === 0) return null;
  const single = photos.length === 1;
  return (
    <div className={cn("grid gap-2", single ? "grid-cols-1" : "grid-cols-2")}>
      {photos.map((photo, i) => (
        <button
          key={photo.id}
          type="button"
          className="overflow-hidden rounded-[10px] border border-border hover:opacity-90"
          aria-label={`${label}, photo ${i + 1} of ${photos.length}, opens full size`}
          onClick={() => setOpen(i)}
        >
          <StoredPhoto
            taskId={taskId}
            photoId={photo.id}
            className={cn(
              "w-full object-cover",
              single ? "aspect-[4/3] max-h-80" : "aspect-square",
            )}
          />
        </button>
      ))}
      <TaskPhotoViewer
        taskId={taskId}
        photos={photos}
        index={open}
        label={label}
        onIndexChange={setOpen}
        onClose={() => setOpen(null)}
      />
    </div>
  );
}

/** A proof link as a chip showing its domain; opens in a new tab. */
export function ProofLinkChip({ link }: { link: string }) {
  return (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-caption text-foreground hover:bg-card-hover"
      aria-label={`Proof link: ${proofLinkDomain(link)}, opens in a new tab`}
    >
      <Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="truncate">{proofLinkDomain(link)}</span>
    </a>
  );
}

/** The task fields a proof block reads. */
export interface TaskProofView {
  id: string;
  photos?: LiveTaskPhoto[] | null;
  proof_link?: string | null;
  sent_back_reason?: string | null;
  completion_note?: string | null;
}

/**
 * What a task shows of its photos and proof (#4635): the reference photos;
 * then, to the assignee and officers, why it was sent back, the proof photos
 * or link, and the assignee's reply. The officer sees these above Confirm and
 * Send back.
 */
export function TaskProof({
  task,
  showProof,
  sentBack,
}: {
  task: TaskProofView;
  /** The proof is the officer's to see before confirming, and the assignee's. */
  showProof: boolean;
  /** The task waits on its assignee after a send-back (Needs changes). */
  sentBack?: boolean;
}) {
  const photos = task.photos ?? [];
  const reference = photos.filter((photo) => photo.kind === "reference");
  const proof = showProof
    ? photos.filter((photo) => photo.kind === "proof")
    : [];
  const link = showProof ? task.proof_link : null;
  const note = showProof ? task.completion_note : null;
  // The reason shows while the task waits on the change, and beside the reply
  // once it is marked done again.
  const reason = showProof && (sentBack || note) ? task.sent_back_reason : null;
  if (
    reference.length === 0 &&
    proof.length === 0 &&
    !link &&
    !reason &&
    !note
  ) {
    return null;
  }
  return (
    <div className="mt-2 grid gap-2">
      {reason ? (
        <p className="rounded-[10px] bg-warning-tint px-2.5 py-1.5 text-caption text-foreground">
          <span className="font-medium">Sent back: </span>
          {reason}
        </p>
      ) : null}
      <TaskPhotoStrip taskId={task.id} photos={reference} label="Photos" />
      <TaskPhotoStrip taskId={task.id} photos={proof} label="Proof" />
      {link ? <ProofLinkChip link={link} /> : null}
      {note ? (
        <p className="text-caption text-foreground">
          <span className="font-medium">Reply: </span>
          {note}
        </p>
      ) : null}
    </div>
  );
}

/** A local preview of a picked file, revoked when it goes. */
function PickedPhoto({ file, className }: { file: File; className?: string }) {
  // Made and revoked in one effect, so a remount (StrictMode runs effects
  // twice) never keeps a URL its own cleanup revoked.
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(file);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL is an external resource made here
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  if (!url)
    return <span className={cn("block bg-muted/40", className)} aria-hidden />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className={className} />;
}

/**
 * Pick several photos at once, shown as thumbnails with a remove button
 * each: the task's own stored ones (editing) and newly picked files. Holds
 * at most `TASK_PHOTOS_MAX` between them.
 */
export function TaskPhotoPicker({
  id,
  taskId,
  kept = [],
  files,
  onKeptChange,
  onFilesChange,
  disabled,
  invalid,
  addLabel = "Add photos",
}: {
  id: string;
  taskId?: string;
  kept?: LiveTaskPhoto[];
  files: File[];
  onKeptChange?: (kept: LiveTaskPhoto[]) => void;
  onFilesChange: (files: File[]) => void;
  disabled?: boolean;
  invalid?: boolean;
  addLabel?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const room = TASK_PHOTOS_MAX - kept.length - files.length;
  const tile =
    "relative h-16 w-16 overflow-hidden rounded-[10px] border border-border";
  const remove = (label: string, onClick: () => void) => (
    <button
      type="button"
      className="absolute right-0.5 top-0.5 rounded-full bg-background/90 p-0.5 text-foreground shadow-sm"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <X className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      {taskId
        ? kept.map((photo, i) => (
            <div key={photo.id} className={tile}>
              <StoredPhoto
                taskId={taskId}
                photoId={photo.id}
                className="h-full w-full object-cover"
              />
              {remove(`Remove photo ${i + 1}`, () =>
                onKeptChange?.(kept.filter((p) => p.id !== photo.id)),
              )}
            </div>
          ))
        : null}
      {files.map((file, i) => (
        <div key={`${file.name}-${i}`} className={tile}>
          <PickedPhoto file={file} className="h-full w-full object-cover" />
          {remove(`Remove ${file.name}`, () =>
            onFilesChange(files.filter((_, j) => j !== i)),
          )}
        </div>
      ))}
      <input
        ref={input}
        id={id}
        type="file"
        multiple
        accept={acceptAttribute("task_photo")}
        className="sr-only"
        tabIndex={-1}
        data-testid={`${id}-input`}
        onChange={(event) => {
          const picked = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (picked.length > 0) onFilesChange([...files, ...picked]);
        }}
      />
      {room > 0 ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className={cn("gap-1.5", invalid && "border-destructive")}
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          <ImagePlus className="h-4 w-4" aria-hidden />
          {addLabel}
        </Button>
      ) : (
        <span className="text-caption text-muted-foreground">
          {TASK_PHOTOS_MAX} photos is the most.
        </span>
      )}
    </div>
  );
}

/** A form's photo state: newly picked files, the task's own kept, and the proof kind. */
export interface TaskPhotoDraft {
  /** Newly picked reference photos, uploaded on save. */
  photoFiles: File[];
  /** Editing: the task's stored reference photos still kept. */
  keptPhotos: LiveTaskPhoto[];
  /** What Mark done needs (#4635). */
  proofKind: TaskProofKind;
}

export const EMPTY_TASK_PHOTO_DRAFT: TaskPhotoDraft = {
  photoFiles: [],
  keptPhotos: [],
  proofKind: "none",
};

const PROOF_KIND_HINTS: Record<TaskProofKind, string> = {
  none: "Marking it done needs nothing more.",
  photo: "Marking it done needs a photo of the finished job.",
  link: "Marking it done needs a link, such as a doc or a post.",
};

/**
 * The create and edit forms' photo fields: reference photos to attach, view
 * or remove, and the officer's proof control (None, Photo, Link), the way
 * Google Classroom and Canvas set what an assignment's submission takes.
 */
export function TaskPhotoFields({
  id,
  taskId,
  draft,
  onChange,
  disabled,
  problem,
}: {
  id: string;
  /** Editing: the task whose stored photos `draft.keptPhotos` are. */
  taskId?: string;
  draft: TaskPhotoDraft;
  onChange: (patch: Partial<TaskPhotoDraft>) => void;
  disabled?: boolean;
  problem?: string | null;
}) {
  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <Label htmlFor={`${id}-photos`}>Photos</Label>
        <p className="text-caption text-muted-foreground">
          What the job looks like (optional, up to {TASK_PHOTOS_MAX}).
        </p>
        <TaskPhotoPicker
          id={`${id}-photos`}
          taskId={taskId}
          kept={draft.keptPhotos}
          files={draft.photoFiles}
          onKeptChange={(keptPhotos) => onChange({ keptPhotos })}
          onFilesChange={(photoFiles) => onChange({ photoFiles })}
          disabled={disabled}
          invalid={!!problem}
        />
        {problem ? <FieldError>{problem}</FieldError> : null}
      </div>
      <div className="grid gap-1">
        <span className="text-label font-medium" id={`${id}-proof-label`}>
          Proof
        </span>
        <SegmentedChoice
          label="Proof to mark it done"
          options={TASK_PROOF_KINDS.map((kind) => ({
            value: kind,
            label: TASK_PROOF_KIND_LABELS[kind],
          }))}
          value={draft.proofKind}
          onChange={(proofKind) => onChange({ proofKind })}
          disabled={disabled}
        />
        <p className="text-caption text-muted-foreground">
          {PROOF_KIND_HINTS[draft.proofKind]}
        </p>
      </div>
    </div>
  );
}

/** What Mark done sends besides the status (#4635). */
export interface CompletionProof {
  proof_photo_paths?: string[];
  proof_link?: string;
  completion_note?: string;
}

/** The task fields Mark done reads. */
export interface MarkDoneTask {
  proof_kind?: TaskProofKind | null;
  /** Set while it waits on the assignee after a send-back. */
  sent_back_at?: string | null;
  sent_back_reason?: string | null;
}

/** Whether a sent-back task is waiting on its change (Needs changes). */
function needsChange(task: MarkDoneTask, sentBack: boolean): boolean {
  return sentBack && !!task.sent_back_at;
}

/**
 * The assignee's Mark done, with proof (#4565, #4635). On a task that asks
 * for a photo or a link, or one an officer sent back, the button opens a
 * sheet that asks for it first: the proof the task needs, or a reply to the
 * reason, the way Canvas and Google Classroom ask for a resubmission. On any
 * other task Mark done works at once, and a camera button beside it opens the
 * sheet to add photos anyway. `onComplete` rejects only for the caller to
 * report.
 */
export function MarkDoneControl({
  title,
  task,
  sentBack,
  label,
  controlProps,
  onComplete,
  onUploadError,
  size = "toolbar",
}: {
  title: string;
  task: MarkDoneTask;
  /** The task is stored IN_PROGRESS with `sent_back_at` (Needs changes). */
  sentBack: boolean;
  label: string;
  controlProps: { disabled?: boolean } & Record<string, unknown>;
  /**
   * Marks it done. Resolves `false` (or rejects) when the write was refused,
   * so the sheet stays open with what the member entered.
   */
  onComplete: (proof: CompletionProof) => Promise<boolean | void>;
  onUploadError: (message: string) => void;
  size?: "toolbar" | "sm";
}) {
  const [open, setOpen] = useState(false);
  const kind = task.proof_kind ?? "none";
  const asks = kind !== "none" || needsChange(task, sentBack);
  const disabled = !!controlProps.disabled;
  return (
    <>
      <Button
        size={size}
        variant="secondary"
        className="gap-1.5"
        {...controlProps}
        disabled={disabled}
        onClick={() =>
          asks ? setOpen(true) : void onComplete({}).catch(() => {})
        }
      >
        {kind === "photo" ? (
          <Camera className="h-4 w-4" aria-hidden="true" />
        ) : kind === "link" ? (
          <Link2 className="h-4 w-4" aria-hidden="true" />
        ) : null}
        {kind === "photo"
          ? `${label} with a photo`
          : kind === "link"
            ? `${label} with a link`
            : label}
      </Button>
      {asks ? null : (
        <Button
          size={size}
          variant="ghost"
          className="w-9 px-0 pointer-coarse:w-11 pointer-coarse:px-0"
          aria-label={`Add photos of the finished job: ${title}`}
          {...controlProps}
          // After the spread: the gate's props carry `title` (undefined while
          // online), which would otherwise wipe the icon's only visible name.
          title={
            typeof controlProps.title === "string"
              ? controlProps.title
              : "Add photos of the finished job"
          }
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          <Camera className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}
      {open ? (
        <MarkDoneDialog
          title={title}
          task={task}
          sentBack={needsChange(task, sentBack)}
          onClose={() => setOpen(false)}
          onComplete={onComplete}
          onUploadError={onUploadError}
        />
      ) : null}
    </>
  );
}

/** Mark done's sheet: the proof the task asks for and, after a send-back, a reply. */
function MarkDoneDialog({
  title,
  task,
  sentBack,
  onClose,
  onComplete,
  onUploadError,
}: {
  title: string;
  task: MarkDoneTask;
  sentBack: boolean;
  onClose: () => void;
  onComplete: (proof: CompletionProof) => Promise<boolean | void>;
  onUploadError: (message: string) => void;
}) {
  const upload = useUploadTaskPhotos();
  const kind = task.proof_kind ?? "none";
  const [files, setFiles] = useState<File[]>([]);
  const [link, setLink] = useState("");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const photoProblem = taskPhotosProblem(files);
    if (photoProblem) return setProblem(photoProblem);
    const trimmedLink = link.trim();
    const proofLink = trimmedLink ? normalizeProofLink(trimmedLink) : null;
    if (trimmedLink && !proofLink) {
      return setProblem("Use a web link that starts with http:// or https://.");
    }
    if (kind === "photo" && files.length === 0) {
      return setProblem("Add at least one photo of the finished job.");
    }
    if (kind === "link" && !proofLink) {
      return setProblem("Add a link to show it's done.");
    }
    const reply = note.trim();
    if (sentBack && files.length === 0 && !proofLink && !reply) {
      return setProblem(
        "Add proof or reply to the officer before marking it done.",
      );
    }
    setProblem(null);
    setBusy(true);
    try {
      let paths: string[] = [];
      try {
        paths = files.length > 0 ? await upload(files) : [];
      } catch (error) {
        onUploadError(uploadFailureMessage(error));
        return;
      }
      const done = await onComplete({
        ...(paths.length > 0 ? { proof_photo_paths: paths } : {}),
        ...(proofLink ? { proof_link: proofLink } : {}),
        ...(reply ? { completion_note: reply } : {}),
      });
      // A refused write keeps the sheet open on what the member entered;
      // the caller already said why.
      if (done !== false) onClose();
    } catch {
      // The caller reported it; keep what was entered.
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark done</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {sentBack && task.sent_back_reason ? (
            <p className="rounded-[10px] bg-warning-tint px-2.5 py-1.5 text-caption text-foreground">
              <span className="font-medium">Sent back: </span>
              {task.sent_back_reason}
            </p>
          ) : null}
          {kind !== "link" ? (
            <div className="grid gap-1">
              <Label htmlFor="mark-done-photos">
                {kind === "photo"
                  ? "Photos of the finished job"
                  : "Photos (optional)"}
              </Label>
              <TaskPhotoPicker
                id="mark-done-photos"
                files={files}
                onFilesChange={setFiles}
                disabled={busy}
              />
            </div>
          ) : (
            <div className="grid gap-1">
              <Label htmlFor="mark-done-link">Link</Label>
              <Input
                id="mark-done-link"
                type="url"
                inputMode="url"
                placeholder="https://"
                value={link}
                disabled={busy}
                onChange={(event) => setLink(event.target.value)}
              />
            </div>
          )}
          {sentBack ? (
            <div className="grid gap-1">
              <Label htmlFor="mark-done-note">Reply to the officer</Label>
              <Textarea
                id="mark-done-note"
                rows={2}
                maxLength={TASK_COMPLETION_NOTE_MAX}
                placeholder="What you changed"
                value={note}
                disabled={busy}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
          ) : null}
          {problem ? <FieldError>{problem}</FieldError> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy}
            className="gap-1.5"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : null}
            Mark done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** What Send back sends (#4635). */
export interface SendBackInput {
  comment: string;
  require_photo?: boolean;
}

/**
 * An officer's Send back (#4635): a required one-line reason, which stays on
 * the task for the assignee, and "Ask for a photo next time" on a task that
 * doesn't already ask for one, the way an Asana approval's "Request changes"
 * and Canvas's resubmission ask for a comment.
 */
export function SendBackDialog({
  title,
  proofKind,
  reasons = [],
  open,
  onClose,
  onSubmit,
}: {
  title: string;
  proofKind: TaskProofKind | null | undefined;
  /** One-tap reasons above the field (#4693); none by default. */
  reasons?: string[];
  open: boolean;
  onClose: () => void;
  onSubmit: (input: SendBackInput) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [askPhoto, setAskPhoto] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Each send-back starts blank, so a reason typed for one task never
  // carries to the next.
  function close() {
    setReason("");
    setAskPhoto(false);
    setProblem(null);
    onClose();
  }

  async function submit() {
    const comment = reason.trim();
    if (!comment) return setProblem("Say what needs to change.");
    setBusy(true);
    try {
      await onSubmit({ comment, ...(askPhoto ? { require_photo: true } : {}) });
      close();
    } catch (error) {
      setProblem(getErrorMessage(error, "Couldn't send it back. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send back</DialogTitle>
          <DialogDescription>
            {title} goes back to its assignee with your reason.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-1">
            <Label htmlFor="send-back-reason">What needs to change</Label>
            {reasons.length > 0 ? (
              <div
                className="flex flex-wrap gap-1.5 pb-1"
                role="group"
                aria-label="Common reasons"
              >
                {reasons.map((chip) => (
                  <Button
                    key={chip}
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="rounded-full"
                    disabled={busy}
                    onClick={() => {
                      setReason((typed) =>
                        withReasonChip(typed, chip).slice(
                          0,
                          TASK_SEND_BACK_REASON_MAX,
                        ),
                      );
                      setProblem(null);
                    }}
                  >
                    {chip}
                  </Button>
                ))}
              </div>
            ) : null}
            <Input
              id="send-back-reason"
              autoFocus
              maxLength={TASK_SEND_BACK_REASON_MAX}
              placeholder="The floor is still sticky"
              value={reason}
              disabled={busy}
              aria-invalid={!!problem}
              onChange={(event) => setReason(event.target.value)}
            />
            <p className="text-caption text-muted-foreground">
              {reason.length}/{TASK_SEND_BACK_REASON_MAX}
            </p>
          </div>
          {proofKind !== "photo" ? (
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="send-back-photo">Ask for a photo next time</Label>
              <Switch
                id="send-back-photo"
                checked={askPhoto}
                disabled={busy}
                onCheckedChange={setAskPhoto}
              />
            </div>
          ) : null}
          {problem ? <FieldError>{problem}</FieldError> : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={close}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Send back
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
