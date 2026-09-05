/**
 * The tombstone a deleted message shows on this client.
 *
 * One constant because it renders in three places, two of which sit in the same
 * viewport: the timeline bubble (`./renderers/text-renderer.tsx`), the quote
 * above a reply to a deleted message (`./reply-quote.tsx`), and the delete
 * confirmation dialog (`./chat-shell.tsx`), which promises the member this exact
 * string is what everyone else will see. Softening the wording in one and not
 * the others would put two different tombstones on screen at once and make the
 * dialog's promise false, and grepping the new string would find only the site
 * that changed.
 *
 * It deliberately matches — but is not imported from — the server's own
 * placeholder in `ChatService`, which rewrites `content` on soft delete. That
 * one is wire data and travels in the row; this one is what the client draws
 * when it has no row to draw. Keeping them equal is a display choice, not a
 * contract, which is why this is a client constant rather than a shared export.
 */
export const DELETED_MESSAGE_PLACEHOLDER = "[message deleted]";
