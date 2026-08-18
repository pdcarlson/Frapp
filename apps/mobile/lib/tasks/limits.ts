/**
 * Client mirrors of the `CreateTaskDto` bounds.
 *
 * Kept in their own module so the sheet's `maxLength` prop and the validator
 * read one constant rather than two literals that drift apart. The server is the
 * authority — see the header of `create-task.ts`.
 */

/** `@MaxLength(255)` on `CreateTaskDto.title`. */
export const TITLE_MAX_LENGTH = 255;

/**
 * `@Max(POINTS_ADJUSTMENT_MAX)` on `CreateTaskDto.point_reward` —
 * `apps/api/src/domain/constants/field-limits.ts:55`.
 */
export const POINTS_MAX = 100_000;
