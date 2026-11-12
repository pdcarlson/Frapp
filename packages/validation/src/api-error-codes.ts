/**
 * The code on every 400 the API's global `ValidationPipe` answers with: a
 * body, query or path DTO it refuses (#4096). The `message` stays the pipe's
 * array of field failures. Clients don't word it (`copyForErrorCode`), since
 * a member's form is validated before it is sent; `@repo/observability`
 * classes it as client-contract, so a client that sends one reports a bug.
 */
export const REQUEST_VALIDATION_FAILED_CODE = "request.validation_failed";

/**
 * The 404 code on `GET /v1/channels/{id}/messages` when its `since` cursor
 * names no message in the channel (#2807). Chat clients read it
 * (`readMessageRows` in `@repo/chat-core/history`) to tell a cursor they should
 * drop from a channel they can't read, which answers 404 too.
 */
export const CHAT_SINCE_NOT_FOUND_CODE = "chat.since_not_found";

/**
 * The API's 410 message for a request from an account that has been deleted
 * but whose session hasn't ended yet. Shared so a client can tell it apart
 * from the other 410s it can meet on the same route (an expired invite).
 */
export const ACCOUNT_DELETED_MESSAGE = "Account has been deleted";
