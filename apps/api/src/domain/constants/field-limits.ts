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
 * Manual points adjustment magnitude, applied symmetrically. The service only
 * *flags* large adjustments against the anomaly threshold — it never rejects
 * them — so this is the only ceiling on a single ledger write.
 */
export const POINTS_ADJUSTMENT_MAX = 100_000;

/**
 * Invoice amount in cents. Anchored to Stripe's own per-charge maximum for USD
 * (99,999,999 = $999,999.99): above this the payment intent could never be
 * created, so accepting the invoice would only defer the failure to payment.
 */
export const INVOICE_AMOUNT_MAX_CENTS = 99_999_999;

/** Free-text invoice description. */
export const INVOICE_DESCRIPTION_MAX_LENGTH = 2_000;

/** Chat message body, shared by send and edit so the two cannot diverge. */
export const CHAT_MESSAGE_CONTENT_MAX_LENGTH = 10_000;
