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
 * Only bounds a client or a schema here also reads belong in this file. The
 * ones only the API enforces (`INT4_MAX`, `POSITION_MAX`, the invoice and
 * role-key bounds) are in `apps/api/src/domain/constants/field-limits.ts`
 * (#3268).
 */

/**
 * Chapter-authored role names and labels (`roles.name`,
 * `chapter_custom_roles.label`). Both columns are unconstrained `text` and both
 * render in member lists and the role picker, so the cap is about keeping an
 * unbounded string out of every surface that displays it. Far above any real
 * role name — the longest in staging is 14 characters.
 */
export const ROLE_NAME_MAX_LENGTH = 100;

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
 * A calendar year a person types: a chapter's founding year, a backwork
 * resource's year. Four digits. The founding year's clients also refuse a year
 * after next (`latestFoundedYear` in `@repo/hooks`); backwork's form checks
 * only its minimum, and a static decorator can't express "after next year".
 */
export const YEAR_MAX = 9_999;

/** Options on one poll, and the fewest a poll may have. */
export const POLL_OPTIONS_MAX = 10;
export const POLL_OPTIONS_MIN = 2;
