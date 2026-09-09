/**
 * The tombstone a deleted message shows on this client.
 *
 * One constant because it renders in three places, two of which sit in the same
 * viewport: the timeline bubble (`./renderers/text-renderer.tsx`), the quote
 * above a reply to a deleted message (`./reply-quote.tsx`), and the delete
 * confirmation dialog (`./chat-shell.tsx`), which promises the member this exact
 * string is what everyone else will see.
 *
 * Canonical definition lives in `@repo/chat-core/reply-preview` so mobile's
 * quote (#1727) cannot drift from web's. Re-exported here so existing web
 * imports keep working.
 */
export { DELETED_MESSAGE_PLACEHOLDER } from "@repo/chat-core/reply-preview";
