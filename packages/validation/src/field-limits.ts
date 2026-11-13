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
 * Chapter-authored role names (`roles.name`). The column is unconstrained
 * `text` and renders in member lists and the role picker, so the cap is about keeping an
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

/**
 * A member's graduation year (`users.graduation_year`), which they set
 * themselves on web `/profile` and mobile s15 (#3387). The API refuses
 * anything outside it, and both clients refuse it before sending.
 */
export const GRADUATION_YEAR_MIN = 1900;
export const GRADUATION_YEAR_MAX = 2100;

/**
 * A member's major (`users.major`), set on web `/profile` and the mobile Edit
 * profile sheet. Long enough for a double major spelled out; the API refuses
 * a longer one and both fields stop at it.
 */
export const MAJOR_MAX_LENGTH = 100;

/**
 * A member's phone number (`users.phone`, #3711), as they typed it, trimmed.
 * Room for an international number with its spaces and an extension; the
 * column's check stops anything longer. {@link isPhoneNumber} is what the API
 * and both forms accept.
 */
export const PHONE_MAX_LENGTH = 32;

/**
 * A member's name as an officer corrects it (`PATCH /v1/members/{id}/profile`,
 * #4367): the API's cap and both correction forms' `maxLength`. The member's
 * own `PATCH /v1/users/me` has no cap yet, so an officer fixing a longer name
 * must shorten it.
 */
export const DISPLAY_NAME_MAX_LENGTH = 100;

/**
 * A chapter document's title (`chapter_documents.title`), set by whoever
 * uploads it on web or mobile s21 (#3399). The API refuses a longer one, and
 * the phone's field stops at it.
 */
export const DOCUMENT_TITLE_MAX_LENGTH = 255;

/**
 * A task's title (`CreateTaskDto.title`), from the task board, the `/task`
 * one-liner and the chat composer's Task form (#3865). The API refuses a
 * longer one; the form and the one-liner say so first.
 */
export const TASK_TITLE_MAX_LENGTH = 255;

/**
 * A subtask's title (`task_subtasks.title`, #4003): one step of a chore,
 * "Wipe the counters". The table's check refuses a longer one.
 */
export const TASK_SUBTASK_TITLE_MAX_LENGTH = 200;

/**
 * Subtasks on one task. A checklist longer than this is a project, not a
 * chore, and a list that size stops reading at a glance.
 */
export const TASK_SUBTASKS_MAX = 20;

/**
 * What a member says they did on a service entry
 * (`service_entries.description`), on web and mobile s20. The API's
 * `CreateServiceEntryDto` refuses a longer one, and s20's field stops at it.
 * Web's service dialog doesn't apply it yet (#3456).
 */
export const SERVICE_DESCRIPTION_MAX_LENGTH = 2_000;

/** Options on one poll, and the fewest a poll may have. */
export const POLL_OPTIONS_MAX = 10;
export const POLL_OPTIONS_MIN = 2;

/**
 * A poll's question and each option's label, as `CreatePollDto` bounds them
 * on the REST route (`POST /v1/channels/:id/polls`). Mobile's New poll sheet
 * stops its fields at the same lengths. That is a client-side cap only: a
 * phone poll posts a `kind: 'poll'` card through the chat send route, which
 * bounds `content` (`CHAT_MESSAGE_CONTENT_MAX_LENGTH`) but not the card's
 * option labels, and web's `/poll` applies no length limit.
 */
export const POLL_QUESTION_MAX_LENGTH = 500;
export const POLL_OPTION_MAX_LENGTH = 200;

/**
 * A sign-up sheet card in chat (`kind: 'signup'`, #3926): its title, the
 * optional details under it, how many slots it lists and each slot's label,
 * and the most spots one slot may hold. The chat send route enforces every
 * one of these on the card (`normalizeSignupCard` in the API); the forms on
 * both clients stop at the same numbers.
 */
export const SIGNUP_TITLE_MAX_LENGTH = 200;
export const SIGNUP_NOTE_MAX_LENGTH = 1_000;
export const SIGNUP_SLOTS_MAX = 20;
export const SIGNUP_SLOT_LABEL_MAX_LENGTH = 120;
export const SIGNUP_SLOT_CAPACITY_MAX = 100;
/**
 * The note a member may add to their answer on a headcount (a sign-up card
 * with `format: 'headcount'`, #3926 step 2): "running 10 minutes late".
 */
export const SIGNUP_ANSWER_NOTE_MAX_LENGTH = 140;
/**
 * A headcount's format and its two fixed slots, which the API writes onto
 * the card whatever a client sent (`normalizeSignupCard`) and both clients
 * draw and answer by (`@repo/chat-core/signups`). One copy, so a client can
 * never key its Answer buttons on ids the server doesn't write.
 */
export const SIGNUP_HEADCOUNT_FORMAT = "headcount";
export const HEADCOUNT_GOING_SLOT_ID = "going";
export const HEADCOUNT_NOT_GOING_SLOT_ID = "not_going";
export const HEADCOUNT_SLOTS: readonly {
  id: string;
  label: string;
  capacity: null;
}[] = [
  { id: HEADCOUNT_GOING_SLOT_ID, label: "Going", capacity: null },
  { id: HEADCOUNT_NOT_GOING_SLOT_ID, label: "Can’t make it", capacity: null },
];
/**
 * How far ahead a sign-up's end time may be set. The API refuses later ones
 * outright; the forms stop a day short of it, so a draft that passes in the
 * form isn't refused by a clock a little ahead on the server.
 */
export const SIGNUP_CLOSES_AT_MAX_AHEAD_DAYS = 366;

/**
 * A form card in chat (`kind: 'form'`, #3926 step 3): a questionnaire posted
 * as a card that opens a full-page form, like Google Forms. The chat send
 * route checks the card against these (`normalizeFormCard` in the API), the
 * answer route checks every answer, and the builders on both clients stop at
 * the same numbers. A form ends at a set time on the sign-up's limit,
 * {@link SIGNUP_CLOSES_AT_MAX_AHEAD_DAYS}.
 */
export const FORM_TITLE_MAX_LENGTH = 200;
export const FORM_DESCRIPTION_MAX_LENGTH = 2_000;
export const FORM_QUESTIONS_MAX = 40;
export const FORM_QUESTION_TITLE_MAX_LENGTH = 300;
export const FORM_OPTIONS_MAX = 30;
export const FORM_OPTION_LABEL_MAX_LENGTH = 200;
/** The longest answer to a short-answer question. */
export const FORM_SHORT_ANSWER_MAX_LENGTH = 300;
/** The longest answer to a paragraph question. */
export const FORM_PARAGRAPH_ANSWER_MAX_LENGTH = 4_000;
/**
 * The kinds of question a form asks. `multiple_choice` and `dropdown` take one
 * option, `checkboxes` any number, `yes_no` a yes or a no, and the two text
 * kinds a line or a paragraph.
 */
export const FORM_QUESTION_TYPES = [
  "short_answer",
  "paragraph",
  "multiple_choice",
  "checkboxes",
  "dropdown",
  "yes_no",
] as const;
export type FormQuestionType = (typeof FORM_QUESTION_TYPES)[number];
/** The question types that list options a member picks from. */
export const FORM_CHOICE_QUESTION_TYPES: readonly FormQuestionType[] = [
  "multiple_choice",
  "checkboxes",
  "dropdown",
];

/**
 * Pledge classes and a member's order number (#3939). The name and number
 * bounds mirror the CHECK constraints in
 * `20261110170000_chapter_pledge_classes.sql`; the two counts are API-side
 * caps on one request and one chapter's list.
 */
export const PLEDGE_CLASS_NAME_MAX_LENGTH = 80;
/** A chapter's whole list rides one reorder request, so it is bounded. */
export const PLEDGE_CLASSES_MAX = 200;
/** `members.order_number`: 1 to this, whether per class or chapter-wide. */
export const MEMBER_ORDER_NUMBER_MAX = 1_000_000;
/** Members one `PUT /v1/pledge-classes/assignments` may carry. */
export const PLEDGE_CLASS_ASSIGNMENTS_MAX = 500;

/**
 * Groups (#4076). The name bound mirrors the CHECK constraint in
 * `20261113040007_chapter_groups.sql`; the counts are API-side caps on one
 * chapter's manual groups and one `PUT /v1/groups/:id/members`.
 */
export const GROUP_NAME_MAX_LENGTH = 80;
export const GROUPS_MAX = 200;
export const GROUP_MEMBERS_MAX = 2_000;

/**
 * Event types (#3730). The name bound mirrors the CHECK constraint in
 * `20261111200000_event_types.sql`; the count is an API-side cap on one
 * chapter's list, which the New event form shows whole.
 */
export const EVENT_TYPE_NAME_MAX_LENGTH = 60;
export const EVENT_TYPES_MAX = 30;
