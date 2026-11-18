/**
 * Client mirrors of the `CreateTaskDto` bounds.
 *
 * Kept in their own module so the sheet's points field and the validator
 * read one constant rather than two literals that drift apart. The server is the
 * authority — see the header of `create-task.ts`. A title's bound is
 * `TASK_TITLE_MAX_LENGTH` in `@repo/validation`, which web reads too.
 */

import { POINTS_ADJUSTMENT_MAX } from "@repo/validation";

/** Same ceiling as `POINTS_ADJUSTMENT_MAX` on `CreateTaskDto.point_reward`. */
export const POINTS_MAX = POINTS_ADJUSTMENT_MAX;
