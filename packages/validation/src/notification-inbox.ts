/**
 * The inbox's first page: how many notifications a client reads when it opens
 * the inbox without naming a `limit` (#4962).
 *
 * Every place that names the page reads it from here:
 * - `useNotifications` (`@repo/hooks`) asks `GET /v1/notifications` for this
 *   page when its caller names no `limit`;
 * - `GET /v1/bootstrap` reads this page for its `notifications` section
 *   (`bootstrap.service.ts` in the API);
 * - the SDK's first-screen batch (`first-screen-batch.ts` in `@repo/api-sdk`)
 *   lets the bootstrap answer only a `GET /v1/notifications` at this page;
 * - the bootstrap DTO's contract description (`bootstrap.dto.ts`).
 *
 * Were they to drift, the SDK would answer a read with a page of a different
 * size and the inbox would silently show fewer rows, or the inbox's read
 * would silently leave the batch.
 */
export const INBOX_FIRST_PAGE_SIZE = 50;
