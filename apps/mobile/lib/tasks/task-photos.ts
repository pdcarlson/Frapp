import {
  MAX_UPLOAD_LABEL,
  TASK_PHOTOS_MAX,
  type TaskProofKind,
} from "@repo/validation";
import {
  pickImages,
  type ImagesPickResult,
  type PickedImage,
  type RequestSignedUpload,
} from "@/lib/chat/attachment-upload";
import { uploadPickedImageGated, type GateCopy } from "@/lib/chat/gated-upload";
import { MODULE_REFUSAL_COPY } from "@/lib/module-refusal";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";

/**
 * Task photos and proof on the phone (#4565, #4635; `spec/behavior/tasks.md`
 * § Photos), the rules the sheets apply, kept here so they're unit-tested.
 *
 * The pipeline is service-hours proof's (`lib/more/service-proof.ts`): pick
 * from the library (several at once, up to what's left under
 * `TASK_PHOTOS_MAX`), gate each on the `task_photo` kind, and upload only on
 * the write that attaches them, so a photo dropped before Save leaves nothing
 * in the bucket. Web's twin is `apps/web/components/tasks/task-photo.tsx`,
 * whose words these match.
 */

/** A photo picked on this device, and its storage path once it's up. */
export interface PendingTaskPhoto {
  image: PickedImage;
  /** Set once uploaded, so a retry after a failed save doesn't upload again. */
  storagePath?: string;
}

const PICK_COPY = {
  askAccess: "Frapp needs access to your photos to add one.",
  settingsAccess: "Allow photo access for Frapp in Settings to add a photo.",
  type: "Use a JPEG, PNG, GIF or WebP photo.",
  size: `That photo is over ${MAX_UPLOAD_LABEL}.`,
};

/** How many more photos fit beside the ones already held. */
export function photoRoom(held: number): number {
  return Math.max(0, TASK_PHOTOS_MAX - held);
}

/** Pick up to `room` photos at once. Uploads nothing; never rejects. */
export function pickTaskPhotos(room: number): Promise<ImagesPickResult> {
  return pickImages({ kind: "task_photo", copy: PICK_COPY }, room);
}

/**
 * The gates the upload route sits under (`@RequireModule('tasks')` and the
 * subscription guard), in the words of the write it leads to: a new or
 * edited task's reference photos, or a Mark done's proof.
 */
export const TASK_PHOTO_GATE_COPY: Record<"task" | "proof", GateCopy> = {
  task: {
    subscription: SUBSCRIPTION_REFUSAL_COPY.task,
    module: MODULE_REFUSAL_COPY.task,
  },
  proof: {
    subscription: SUBSCRIPTION_REFUSAL_COPY.taskStatus,
    module: MODULE_REFUSAL_COPY.taskStatus,
  },
};

export type TaskPhotosUploadResult =
  | { status: "uploaded"; photos: PendingTaskPhoto[]; paths: string[] }
  /**
   * One didn't go up. `photos` keeps the paths of those that did, so the
   * next try sends only the rest; `final` is a gate only an officer lifts.
   */
  | {
      status: "refused";
      photos: PendingTaskPhoto[];
      reason: string;
      final: boolean;
    };

/**
 * Upload each photo not yet up, one at a time, in order. Never rejects.
 */
export async function uploadTaskPhotos(
  photos: readonly PendingTaskPhoto[],
  requestUploadUrl: RequestSignedUpload,
  copy: GateCopy,
): Promise<TaskPhotosUploadResult> {
  const done: PendingTaskPhoto[] = [...photos];
  for (let i = 0; i < done.length; i += 1) {
    const photo = done[i]!;
    if (photo.storagePath) continue;
    const put = await uploadPickedImageGated(
      photo.image,
      requestUploadUrl,
      copy,
    );
    if (put.status !== "uploaded") {
      return {
        status: "refused",
        photos: done,
        reason: put.reason,
        final: put.final,
      };
    }
    done[i] = { ...photo, storagePath: put.image.storagePath };
  }
  return {
    status: "uploaded",
    photos: done,
    paths: done.map((photo) => photo.storagePath!),
  };
}

/** The task fields Mark done reads. */
export interface MarkDoneTask {
  proofKind: TaskProofKind;
  /** It waits on its assignee after a send-back (Needs changes). */
  sentBack: boolean;
}

/**
 * Whether Mark done opens its sheet first (#4635): the task asks for a photo
 * or a link, or an officer sent it back and it needs something new. Any other
 * task is marked done at once, as before.
 */
export function markDoneAsks(task: MarkDoneTask): boolean {
  return task.proofKind !== "none" || task.sentBack;
}

/** Mark done's label: "Mark done with a photo" on a task that asks for one. */
export function markDoneLabel(base: string, proofKind: TaskProofKind): string {
  if (proofKind === "photo") return `${base} with a photo`;
  if (proofKind === "link") return `${base} with a link`;
  return base;
}
