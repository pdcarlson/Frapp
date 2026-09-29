/**
 * The tombstone a deleted message shows on this client.
 *
 * One constant because it renders in several places, two of which sit in the
 * same viewport: the timeline bubble (`./renderers/text-renderer.tsx`, the one
 * importer of this re-export) and the quote above a reply to a deleted message.
 * The quote and the delete confirmation, which promises the member this exact
 * string is what everyone else will see, read it from chat-core directly
 * (`reply-preview`, and `DELETE_MESSAGE_CONFIRM_BODY` in `message-actions`).
 *
 * Canonical definition lives in `@repo/chat-core/reply-preview` so mobile's
 * quote (#1727) cannot drift from web's. Re-exported here so existing web
 * imports keep working.
 */
export { DELETED_MESSAGE_PLACEHOLDER } from "@repo/chat-core/reply-preview";
