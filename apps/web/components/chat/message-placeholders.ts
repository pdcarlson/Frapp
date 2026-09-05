/**
 * The tombstone a deleted message shows on this client.
 *
 * One constant because it now renders in two places that sit in the same
 * viewport: the timeline bubble (`./renderers/text-renderer.tsx`) and the quote
 * above a reply to a deleted message (`./reply-quote.tsx`). Softening the
 * wording in one and not the other would put two different tombstones on screen
 * at once, and grepping the new string would find only the site that changed.
 *
 * It deliberately matches — but is not imported from — the server's own
 * placeholder in `ChatService`, which rewrites `content` on soft delete. That
 * one is wire data and travels in the row; this one is what the client draws
 * when it has no row to draw. Keeping them equal is a display choice, not a
 * contract, which is why this is a client constant rather than a shared export.
 */
export const DELETED_MESSAGE_PLACEHOLDER = "[message deleted]";
