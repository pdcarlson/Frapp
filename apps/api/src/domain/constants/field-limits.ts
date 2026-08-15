/**
 * Shared bounds for client-supplied field values (#849).
 *
 * These live here, beside `list-query-limits.ts`, rather than as literals in
 * each DTO for two reasons: sibling DTOs writing the same column should not be
 * able to drift apart, and a bound repeated in both `@ApiProperty` and its
 * validator can otherwise be raised in one place only — leaving the generated
 * `openapi.json` advertising a limit the API no longer enforces, with CI green
 * because the contract still matches the decorators it was generated from.
 */

/**
 * Chapter-authored role names and labels (`roles.name`,
 * `chapter_custom_roles.label`). Both columns are unconstrained `text` and both
 * render in member lists and the role picker, so the cap is about keeping an
 * unbounded string out of every surface that displays it. Far above any real
 * role name — the longest in staging is 14 characters.
 */
export const ROLE_NAME_MAX_LENGTH = 100;

/** Machine-readable role slug (`chapter_custom_roles.key`). */
export const ROLE_KEY_MAX_LENGTH = 64;

/**
 * Points magnitude for a single ledger write, applied symmetrically. The
 * service only *flags* large adjustments against the anomaly threshold — it
 * never rejects them — so validation is the only ceiling.
 *
 * The rule: **every client-supplied value that reaches a
 * `point_transactions` write carries this ceiling at its request field.** Not
 * only the manual path — capping that alone would leave broader grants able to
 * mint amounts `points:adjust` cannot, and the ledger is append-only, so
 * corrections are themselves adjustments bound by this same constant and an
 * uncapped write is not fully reversible.
 *
 * Deliberately not a list. Three review rounds each enumerated the award paths
 * and each undercounted — attendance, tasks, study, and service accrual all
 * write this column, some through Postgres RPCs rather than a service. The
 * authoritative enumeration is the table in `dto-constraint-coverage.spec.ts`,
 * which fails in CI; prose that counts them rots silently. When you add an
 * award path, add its row there.
 *
 * One real exception, stated rather than glossed: a study award is
 * `intervals × points_per_interval`, and the interval count comes from
 * server-measured session length rather than the request, so bounding the input
 * cannot bound the row. Clamping that computed award is a product decision
 * tracked in #948. Service accrual looks similar but is not: its award is
 * `floor(duration_minutes / minutesPerPoint)` with `minutesPerPoint >= 1`, so
 * capping `duration_minutes` bounds the row provably.
 *
 * It also keeps the value inside `int4`: `point_transactions.amount` and
 * `events.point_value` are both `int`, so an unbounded `@IsInt()` overflows
 * inside Postgres and surfaces as a 500 rather than a 400 at the edge.
 */
export const POINTS_ADJUSTMENT_MAX = 100_000;

/**
 * Reason attached to a manual adjustment. Capped because it is not only stored:
 * `PointsService` interpolates it into the points chat card's `content`
 * (`"<verb> N points to <member>: <reason>"`) and posts that through the
 * service directly, never through `SendMessageDto` — so without a bound here
 * the chat column's own cap below is trivially side-stepped.
 */
export const POINTS_REASON_MAX_LENGTH = 500;

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

/** Chat message body, shared by send and edit so the two cannot diverge. */
export const CHAT_MESSAGE_CONTENT_MAX_LENGTH = 10_000;
