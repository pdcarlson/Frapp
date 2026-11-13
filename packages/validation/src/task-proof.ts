/**
 * What a task asks for when it is marked done (#4635), set per task by an
 * officer: nothing, one or more photos, or a link. It replaced #4565's
 * `photo_required` switch. `spec/behavior/tasks.md` § Photos.
 */
export const TASK_PROOF_KINDS = ["none", "photo", "link"] as const;
export type TaskProofKind = (typeof TASK_PROOF_KINDS)[number];

/** The control's words, in the order it shows them. */
export const TASK_PROOF_KIND_LABELS: Record<TaskProofKind, string> = {
  none: "None",
  photo: "Photo",
  link: "Link",
};

/**
 * Photos per task and kind: up to 6 reference photos on a task, and up to 6
 * proof photos on a completion. Six keeps a proof grid readable at a glance
 * on a phone. The API refuses a 7th.
 */
export const TASK_PHOTOS_MAX = 6;

/** An officer's reason for sending a completion back: one line. */
export const TASK_SEND_BACK_REASON_MAX = 200;
/** The assignee's reply when they mark a sent-back task done again. */
export const TASK_COMPLETION_NOTE_MAX = 500;
/** A proof link, stored as typed. */
export const TASK_PROOF_LINK_MAX = 2048;

/**
 * The 400 `PATCH /v1/tasks/:id/status` answers when a task is marked done
 * without the proof its kind asks for: no photo on a Photo task (#4565), or
 * no link on a Link task (#4635). The code is the contract, as
 * `SERVICE_RECEIPT_REQUIRED_CODE`'s is: an installed phone build matches it
 * for as long as it lives, so it never changes.
 */
export const TASK_PROOF_REQUIRED_CODE = "task.proof_required";
export const TASK_PROOF_REQUIRED_MESSAGE =
  "This task needs a photo to show it's done. Add one, then mark it done.";
export const TASK_PROOF_LINK_REQUIRED_MESSAGE =
  "This task needs a link to show it's done. Add one, then mark it done.";

/**
 * The 400 when a task an officer sent back is marked done again with nothing
 * new (#4635): no fresh proof and no reply to the reason. Stable, like
 * `TASK_PROOF_REQUIRED_CODE`.
 */
export const TASK_RESUBMIT_NEEDS_CHANGE_CODE = "task.resubmit_needs_change";
export const TASK_RESUBMIT_NEEDS_CHANGE_MESSAGE =
  "This task was sent back. Add proof or reply to the officer, then mark it done.";

/**
 * Whether a completed task waits on an officer's sign-off (#4635, decision
 * C): only one with points or required proof does. Any other is Done when
 * the assignee marks it done; an officer can still send it back.
 */
export function taskNeedsSignOff(task: {
  point_reward?: number | null;
  proof_kind?: TaskProofKind | string | null;
}): boolean {
  return (
    (task.point_reward ?? 0) > 0 ||
    (task.proof_kind != null && task.proof_kind !== "none")
  );
}

/**
 * A proof link as Frapp keeps it: trimmed, http or https only, or `null`
 * when it isn't one. Never fetched; shown as its domain.
 */
export function normalizeProofLink(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > TASK_PROOF_LINK_MAX) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  return trimmed;
}

/** The domain a proof link chip shows ("docs.google.com"). */
export function proofLinkDomain(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return link;
  }
}
