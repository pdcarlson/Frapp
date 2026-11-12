/**
 * The 400 `PATCH /v1/tasks/:id/status` answers when a task with "Photo
 * required" on is marked done without a `proof_photo_path` (#4565). The code
 * is the contract, as `SERVICE_RECEIPT_REQUIRED_CODE`'s is: an installed
 * phone build matches it for as long as it lives, so it never changes.
 */
export const TASK_PROOF_REQUIRED_CODE = "task.proof_required";
export const TASK_PROOF_REQUIRED_MESSAGE =
  "This task needs a photo to show it's done. Add one, then mark it done.";
