/**
 * The 400 `POST /v1/service-entries` answers when the chapter's
 * `wf_hours_receipt` workflow is on and the entry carries no `proof_path`.
 * `ServiceEntryService.create` throws both, as `{ code, message }` (#1020).
 * A member can't read the workflow itself (`GET /v1/chapters/:id/config`
 * needs `chapter-config:view`), so this answer is how the phone learns of it:
 * mobile s20 recognises the refusal by the code and asks for a photo.
 *
 * The code is the contract, not the message. A mobile build is matched
 * against whatever the API sends for as long as it stays installed, so
 * matching the English sentence would break every shipped build the day it
 * is reworded. The code never changes; the message can, and web shows it as
 * the toast's description.
 */
export const SERVICE_RECEIPT_REQUIRED_CODE = "service_entry.receipt_required";
export const SERVICE_RECEIPT_REQUIRED_MESSAGE =
  "This chapter requires a receipt (photo or signed slip) with service-hour submissions — attach proof and resubmit";
