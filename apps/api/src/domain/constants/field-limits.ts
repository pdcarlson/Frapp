/**
 * Request-field bounds only the API enforces (#3268).
 *
 * The bounds a client also checks, or that a shared Zod schema carries, stay in
 * `packages/validation/src/field-limits.ts`. These moved back here because no
 * client reads them. Either way a DTO imports its bound rather than repeating
 * a literal: a bound repeated in both `@ApiProperty` and its validator can be
 * raised in one place only, leaving the generated `openapi.json` advertising a
 * limit the API no longer enforces, with CI green because the contract still
 * matches the decorators it was generated from.
 */

/** Machine-readable role slug (`chapter_custom_roles.key`). */
export const ROLE_KEY_MAX_LENGTH = 64;

/**
 * Invoice amount in cents. Anchored to Stripe's own per-charge maximum for USD
 * (99,999,999 = $999,999.99): above this the payment intent could never be
 * created, so accepting the invoice would only defer the failure to payment.
 */
export const INVOICE_AMOUNT_MAX_CENTS = 99_999_999;

/** Invoice title, shared by create and update so the two cannot diverge. */
export const INVOICE_TITLE_MAX_LENGTH = 255;

/** Free-text invoice description. */
export const INVOICE_DESCRIPTION_MAX_LENGTH = 2_000;

/**
 * The largest value a Postgres `int` (int4) column holds (#3045).
 *
 * `enableImplicitConversion` lets any integer clear `@IsInt()`, and Postgres
 * answers one past this with `22003 integer out of range`, which reaches the
 * client as a 500 rather than a 400 naming the field. Several of those writes
 * were also partial: a config PATCH committed its `chapters` row and skipped
 * the audit row, and a Discord channel mapping deleted the old rows before the
 * insert failed. So every `@IsInt()` request field that reaches an `int`
 * column carries a `@Max`, and `dto-constraint-coverage.spec.ts` fails on one
 * that doesn't.
 *
 * This is the fallback, for a field with no product ceiling (a workflow
 * threshold whose units vary, an import's message count). Prefer a bound that
 * means something where one exists.
 */
export const INT4_MAX = 2_147_483_647;

/**
 * A list position a client may set: role and category `display_order`, custom
 * field `sort`, document folder `sort_order`, custom role `rank`.
 *
 * Generous, so no position a chapter has stored is refused when a form sends
 * it back unchanged, but well below {@link INT4_MAX}: a list placed last
 * computes `max + 1` (`CustomFieldService.nextSort`,
 * `ChapterDocumentService.nextSortOrder`, the Discord role import, and the web
 * chat admin for a new category), and a row stored at `INT4_MAX` itself would
 * make every later create in that list fail. Rows already stored at
 * `INT4_MAX` before this bound are not repaired here.
 */
export const POSITION_MAX = 1_000_000_000;
