"use client";

import { useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import {
  putSignedUpload,
  useRequestTaskPhotoUploadUrl,
  useTaskPhotoUrl,
  type TaskPhotoKind,
} from "@repo/hooks";
import {
  MAX_UPLOAD_LABEL,
  acceptAttribute,
  inspectUploadFile,
  readSignedUpload,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { FilePicker } from "@/components/shared/file-picker";
import { FieldError } from "@/components/shared/short-form";
import { cn } from "@/lib/utils";

/**
 * Task photos on web (#4565, `spec/behavior/tasks.md` § Photos): the
 * service-hours proof flow, photos only. A photo is checked here for type and
 * size, uploaded to a signed URL the API mints under the chapter's `tasks/`
 * prefix, and its `storage_path` sent with the write that attaches it.
 */

export const TASK_PHOTO_HINT = `A JPEG, PNG, GIF or WebP photo, up to ${MAX_UPLOAD_LABEL}.`;

/** Why a picked file can't be a task photo, or null when it can. */
export function taskPhotoProblem(file: File): string | null {
  const inspected = inspectUploadFile("task_photo", file);
  if (inspected.ok) return null;
  return inspected.reason === "size"
    ? `That photo is over ${MAX_UPLOAD_LABEL}.`
    : "Use a JPEG, PNG, GIF or WebP photo.";
}

/**
 * Upload one photo and resolve its `storage_path`. Rejects with a sentence
 * to show when the file is refused or the upload fails.
 */
export function useUploadTaskPhoto() {
  const requestUrl = useRequestTaskPhotoUploadUrl();
  return async (file: File): Promise<string> => {
    const inspected = inspectUploadFile("task_photo", file);
    if (!inspected.ok) {
      throw new Error(taskPhotoProblem(file) ?? TASK_PHOTO_HINT);
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
    return storagePath;
  };
}

/**
 * One of a task's photos as a small thumbnail that opens full size in a new
 * tab, the way an Asana or Todoist attachment opens. Draws nothing while the
 * link loads or when it can't be read, so a tile never shows a broken image.
 */
export function TaskPhotoThumb({
  taskId,
  photo,
  path,
  label,
  className,
}: {
  taskId: string;
  photo: TaskPhotoKind;
  path: string | null | undefined;
  /** What the photo is, for its name and its caption. */
  label: string;
  className?: string;
}) {
  const url = useTaskPhotoUrl(taskId, photo, path);
  if (!path || !url.data) return null;
  return (
    <a
      href={url.data}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "group inline-flex flex-col items-start gap-1 rounded-[10px] text-caption text-muted-foreground",
        className,
      )}
      aria-label={`${label}, opens full size`}
    >
      {/* A signed URL on the storage origin, not a Next image asset. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url.data}
        alt=""
        className="h-16 w-16 rounded-[10px] border border-border object-cover group-hover:opacity-90"
      />
      <span>{label}</span>
    </a>
  );
}

/** A task's reference and proof photos side by side, when it has either. */
export function TaskPhotos({
  task,
  showProof,
}: {
  task: {
    id: string;
    reference_photo_path?: string | null;
    proof_photo_path?: string | null;
  };
  /** The proof is the officer's to see before confirming, and the assignee's. */
  showProof: boolean;
}) {
  const proof = showProof ? task.proof_photo_path : null;
  if (!task.reference_photo_path && !proof) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-3">
      <TaskPhotoThumb
        taskId={task.id}
        photo="reference"
        path={task.reference_photo_path}
        label="Photo"
      />
      <TaskPhotoThumb
        taskId={task.id}
        photo="proof"
        path={proof}
        label="Proof"
      />
    </div>
  );
}

/** A form's photo state: a new file, the task's own photo kept, or none. */
export interface TaskPhotoDraft {
  /** A newly picked photo, uploaded on save. */
  photoFile: File | null;
  /** Editing: the task's own photo was removed. */
  photoRemoved: boolean;
  /** "Photo required" for Mark done. */
  photoRequired: boolean;
}

export const EMPTY_TASK_PHOTO_DRAFT: TaskPhotoDraft = {
  photoFile: null,
  photoRemoved: false,
  photoRequired: false,
};

/**
 * The create and edit forms' photo fields: a reference photo to attach, view
 * or remove, and the officer's "Photo required" switch.
 */
export function TaskPhotoFields({
  id,
  draft,
  onChange,
  existing,
  disabled,
  problem,
}: {
  id: string;
  draft: TaskPhotoDraft;
  onChange: (patch: Partial<TaskPhotoDraft>) => void;
  /** Editing a task that has a photo: its id and stored path. */
  existing?: { taskId: string; path: string | null | undefined };
  disabled?: boolean;
  problem?: string | null;
}) {
  const keepsExisting =
    !!existing?.path && !draft.photoRemoved && !draft.photoFile;
  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <Label htmlFor={`${id}-photo`}>Photo</Label>
        {keepsExisting && existing ? (
          <div className="flex items-end gap-3">
            <TaskPhotoThumb
              taskId={existing.taskId}
              photo="reference"
              path={existing.path}
              label="Current photo"
            />
            <Button
              id={`${id}-photo`}
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => onChange({ photoRemoved: true })}
            >
              Remove photo
            </Button>
          </div>
        ) : (
          <FilePicker
            id={`${id}-photo`}
            kind="task_photo"
            testId="task-photo-input"
            layout="card"
            chooseLabel="Add a photo"
            emptyLabel="What the job looks like (optional)"
            file={draft.photoFile}
            invalid={!!problem}
            onPick={(file) => onChange({ photoFile: file })}
          />
        )}
        {problem ? <FieldError>{problem}</FieldError> : null}
      </div>
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <Label htmlFor={`${id}-photo-required`}>Photo required</Label>
          <p className="text-caption text-muted-foreground">
            Marking it done needs a photo of the finished job.
          </p>
        </div>
        <Switch
          id={`${id}-photo-required`}
          checked={draft.photoRequired}
          disabled={disabled}
          onCheckedChange={(checked) => onChange({ photoRequired: checked })}
        />
      </div>
    </div>
  );
}

/**
 * The assignee's Mark done, with a proof photo (#4565). On a task with "Photo
 * required" the button itself asks for the photo, then marks it done with it,
 * the way TaskRabbit and Thumbtack ask for a photo of the finished job. On any
 * other task Mark done works as before, and a camera button beside it marks
 * it done with a photo. `onComplete` gets the uploaded photo's path, if any,
 * and rejects only for the caller to report.
 */
export function MarkDoneControl({
  title,
  photoRequired,
  label,
  controlProps,
  onComplete,
  onUploadError,
  size = "toolbar",
}: {
  title: string;
  photoRequired: boolean;
  label: string;
  controlProps: { disabled?: boolean } & Record<string, unknown>;
  onComplete: (proofPhotoPath?: string) => void | Promise<void>;
  onUploadError: (message: string) => void;
  size?: "toolbar" | "sm";
}) {
  const upload = useUploadTaskPhoto();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const disabled = !!controlProps.disabled || uploading;

  async function withPhoto(file: File) {
    setUploading(true);
    try {
      const path = await upload(file);
      await onComplete(path);
    } catch (error) {
      onUploadError(
        error instanceof Error && error.message
          ? error.message
          : "The photo didn't upload. Try again.",
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <input
        ref={fileInput}
        type="file"
        accept={acceptAttribute("task_photo")}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="task-proof-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void withPhoto(file);
        }}
      />
      <Button
        size={size}
        variant="secondary"
        className="gap-1.5"
        {...controlProps}
        disabled={disabled}
        onClick={() =>
          photoRequired ? fileInput.current?.click() : void onComplete()
        }
      >
        {uploading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : photoRequired ? (
          <Camera className="h-4 w-4" aria-hidden="true" />
        ) : null}
        {photoRequired ? `${label} with a photo` : label}
      </Button>
      {photoRequired ? null : (
        <Button
          size={size}
          variant="ghost"
          className="w-9 px-0 pointer-coarse:w-11 pointer-coarse:px-0"
          aria-label={`Add a photo of the finished job: ${title}`}
          title="Add a photo of the finished job"
          {...controlProps}
          disabled={disabled}
          onClick={() => fileInput.current?.click()}
        >
          <Camera className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}
    </>
  );
}
