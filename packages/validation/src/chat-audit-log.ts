/**
 * The chapter's audit log (`#chapter-audit`, #3909): what may change on a
 * line already in it. The API enforces this (`ChannelAccessService`) and both
 * clients offer only what it allows, so a control is never drawn for a change
 * the server refuses. `spec/behavior/chat/README.md` § The audit log is
 * system-write only.
 *
 * The record Frapp writes there can't be altered or erased: none of its lines
 * is deleted, and nothing in the channel takes a new pin or flag, which would
 * raise one line above the rest. Taking a pin or a flag off is always
 * allowed, so one added before the channel became read-only can still go,
 * and a line a member wrote there before then can still be deleted, by its
 * author, an officer, or an officer acting on a report.
 */
import { SYSTEM_SENDER_ID } from "./chat-message";

/**
 * The API's refusal for any write in the audit log: a post, a thread reply or
 * a vote, a new pin or flag on any of its lines, and a delete of one of
 * Frapp's entries. Its own words rather than the generic "no access", since
 * every member can read the channel. Shared so the member copy
 * (`SERVER_MESSAGE_COPY`) keys on the sentence the API throws.
 */
export const AUDIT_LOG_READ_ONLY_REFUSAL =
  "The audit log is read-only. Only Frapp posts in it, its entries can’t be removed, and nothing in it can be flagged or pinned.";

/** A change to a message already in a channel, which authorizes as a `modify`. */
export type ChatMessageChange = "delete" | "pin" | "unpin" | "flag" | "unflag";

/**
 * Whether Frapp wrote this line: a `system_audit` row (an audit-log entry,
 * or another notice from Frapp) or anything the system actor sent. Either
 * field is enough, so a caller that knows only one of them (a report's
 * snapshot keeps the sender, not the kind) still gets the answer.
 */
export function isServerWrittenLine(message: {
  kind?: string | null;
  sender_id?: string | null;
}): boolean {
  return (
    message.kind === "system_audit" || message.sender_id === SYSTEM_SENDER_ID
  );
}

/**
 * Whether the audit log takes `change` on `message`. Only the audit log asks:
 * every other channel leaves the change to who may make it (the sender, or
 * `channels:manage`).
 */
export function auditLogAllowsChange(
  change: ChatMessageChange,
  message: { kind?: string | null; sender_id?: string | null },
): boolean {
  switch (change) {
    case "unpin":
    case "unflag":
      return true;
    case "pin":
    case "flag":
      return false;
    case "delete":
      return !isServerWrittenLine(message);
  }
}
