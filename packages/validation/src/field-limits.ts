/**
 * Shared bounds for client-supplied field values (#849, Wave 1 item 2).
 *
 * These live in `@repo/validation` rather than as literals in each DTO (or a
 * second copy on mobile) for two reasons: sibling writers of the same column
 * should not be able to drift apart, and a bound repeated in both
 * `@ApiProperty` and its validator can otherwise be raised in one place only —
 * leaving the generated `openapi.json` advertising a limit the API no longer
 * enforces, with CI green because the contract still matches the decorators it
 * was generated from.
 *
 * Previously `apps/api/src/domain/constants/field-limits.ts`. The API DTOs,
 * Zod schemas in this package, and mobile task limits all import from here.
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

/**
 * A chapter's short name (`branding.short_name`, #2876): the mark a chapter
 * shows when it has no logo, in place of Greek letters ("FIJI" for a Phi Gamma
 * Delta chapter). It renders inside the web nav's 28px chapter tile, which
 * holds about four characters at its type size and six at the smaller one it
 * steps down to, so the cap is the tile, not the column.
 */
export const CHAPTER_SHORT_NAME_MAX_LENGTH = 6;

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
 * Far above any list a chapter keeps, and far below {@link INT4_MAX} on
 * purpose: the services that place a new row last compute `max + 1`, so a row
 * stored at `INT4_MAX` itself would make every later create in that list 500.
 */
export const POSITION_MAX = 1_000_000;

/**
 * A calendar year a person types: a backwork resource's year, a chapter's
 * founding year. Four digits; the clients hold the tighter "not after next
 * year" bound, which a static decorator can't express.
 */
export const YEAR_MAX = 9_999;

/**
 * A study zone's minute settings (`minutes_per_point`, `min_session_minutes`,
 * `pause_grace_minutes`). A day: a session is kept alive by a heartbeat every
 * five minutes, so no setting longer than that can ever be met.
 */
export const STUDY_ZONE_MINUTES_MAX = 24 * 60;

/** Options on one poll; an option index is below this. */
export const POLL_OPTIONS_MAX = 10;
