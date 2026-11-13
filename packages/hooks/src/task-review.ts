import {
  formatActedLabel,
  formatPointsChip,
  isDueOverdue,
} from "@repo/formatting";
import type { TaskProofKind } from "@repo/validation";
import type { LiveTask, LiveTaskPhoto } from "./task-card";

/**
 * An officer's review of a submitted task (#4693): what the review sheet on
 * both apps shows, in the order it shows it. Who handed it in and when, the
 * proof (the thing being judged), the send-back it answers on a resubmission,
 * the assignee's reply, and a Confirm that says what it pays. Chore apps with
 * photo proof (S'moresUp, Chores Tracker) and Classroom's grader put the work
 * first and name the payout on the approve button the same way.
 */
export interface TaskReview {
  /** `"Submitted today at 9:04 PM"`, or `"Resubmitted …"` after a send-back. */
  submitted: string | null;
  resubmitted: boolean;
  /** Against the due date: handed in `"on time"` or `"late"`; null without one. */
  timing: "on time" | "late" | null;
  /** `"Confirm · +10 pts"`, or `"Confirm"` for a task with no points. */
  confirmLabel: string;
  /** Why it was sent back, while this submission answers it. */
  sentBackReason: string | null;
  /** The assignee's reply sent with Mark done. */
  note: string | null;
  proofPhotos: LiveTaskPhoto[];
  referencePhotos: LiveTaskPhoto[];
  link: string | null;
}

/**
 * Whether a live task is waiting on an officer's sign-off: marked done and
 * not yet confirmed. The persisted status decides, since the display status
 * can read OVERDUE.
 */
export function isAwaitingReview(task: LiveTask): boolean {
  const stored = task.stored_status ?? task.status;
  return stored === "COMPLETED" && !task.confirmed_at && !task.points_awarded;
}

export function taskReview(task: LiveTask, now: Date = new Date()): TaskReview {
  // A task sent back and marked done again keeps its send-back stamp until
  // it is confirmed: that is what makes this a resubmission.
  const resubmitted = !!task.sent_back_at && !!task.completed_at;
  const handedIn = task.completed_at ? new Date(task.completed_at) : null;
  const timing =
    task.due && handedIn && !Number.isNaN(handedIn.getTime())
      ? isDueOverdue(task.due, handedIn)
        ? "late"
        : "on time"
      : null;
  const photos = task.photos ?? [];
  return {
    submitted: task.completed_at
      ? formatActedLabel(
          resubmitted ? "Resubmitted" : "Submitted",
          task.completed_at,
          now,
        )
      : null,
    resubmitted,
    timing,
    confirmLabel: task.point_reward
      ? `Confirm · ${formatPointsChip(task.point_reward)}`
      : "Confirm",
    sentBackReason: resubmitted ? task.sent_back_reason : null,
    note: task.completion_note?.trim() || null,
    proofPhotos: photos.filter((photo) => photo.kind === "proof"),
    referencePhotos: photos.filter((photo) => photo.kind === "reference"),
    link: task.proof_link,
  };
}

/**
 * One-tap reasons on Send back (#4693), picked for what the task asked as
 * proof: the common ways a photo or a link misses, and "Not finished" for
 * all. Tapping one fills the reason, which the officer can still edit.
 */
export function sendBackReasonChips(
  proofKind: TaskProofKind | null | undefined,
): string[] {
  switch (proofKind) {
    case "photo":
      return ["Photo doesn't show it", "Not finished", "Wrong photo"];
    case "link":
      return ["Link doesn't open", "Not finished", "Wrong link"];
    default:
      return ["Not finished", "Needs another look"];
  }
}

/**
 * The reason after a chip is tapped: the chip alone when nothing is typed,
 * else added after what is, so a tap never throws typing away.
 */
export function withReasonChip(reason: string, chip: string): string {
  const typed = reason.trim();
  if (!typed) return chip;
  if (typed.toLowerCase().includes(chip.toLowerCase())) return typed;
  return `${typed.replace(/[.,;]+$/, "")}. ${chip}`;
}
