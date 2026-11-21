import { createHash } from 'node:crypto';
import {
  Logger,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  POINTS_ADJUSTMENT_MAX,
  POINTS_REASON_MAX_LENGTH,
} from '@repo/validation';
import { SystemPermissions } from '#domain/constants/permissions';
import type { AiSuggestionPayload } from '#domain/entities/ai-suggestion.entity';
import type {
  AiSuggestionCommitResult,
  AiSuggestionKindHandler,
} from './ai-suggestion-kinds';
import { PointsService } from './points.service';

/**
 * The most members one points proposal may name. A chapter's hourly
 * adjustment limit (50 unless the chapter changed it) is usually reached
 * first; this only keeps a proposal inside the suggestion row's size.
 */
export const POINTS_SUGGESTION_MAX_MEMBERS = 300;

/** A points proposal is stale by the next day (the acting agent, #718). */
const POINTS_SUGGESTION_EXPIRY_DAYS = 1;

/** Adjustments made side by side while a proposal is carried out. */
const COMMIT_CONCURRENCY = 5;

/**
 * A proposed points change, as stored and as listed: the same amount, for
 * the same reason, to each member named. Always the `MANUAL` category; a
 * formal fine stays a thing an officer does by hand on the Points page.
 */
export interface PointsSuggestionPayload {
  amount: number;
  reason: string;
  target_user_ids: string[];
  /** The event whose attendance the members were read from, when it was. */
  event_id: string | null;
  /** That event's name and start, so the card can say whose attendance it is. */
  event_name: string | null;
  event_start_time: string | null;
}

function eventLabel(input: Record<string, unknown>): {
  event_name: string | null;
  event_start_time: string | null;
} {
  const name =
    typeof input.event_name === 'string'
      ? input.event_name.replace(/\s+/g, ' ').trim().slice(0, 255)
      : '';
  const at =
    typeof input.event_start_time === 'string' &&
    input.event_start_time.length <= 40
      ? Date.parse(input.event_start_time)
      : NaN;
  return {
    event_name: name || null,
    event_start_time: Number.isNaN(at) ? null : new Date(at).toISOString(),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function amountOrNull(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value !== 0 &&
    Math.abs(value) <= POINTS_ADJUSTMENT_MAX
    ? value
    : null;
}

function reasonOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const flat = value.replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return flat.length > POINTS_REASON_MAX_LENGTH
    ? flat.slice(0, POINTS_REASON_MAX_LENGTH).trimEnd()
    : flat;
}

function memberIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter(
    (id): id is string => typeof id === 'string' && UUID.test(id),
  );
  return [...new Set(ids.map((id) => id.toLowerCase()))];
}

/** Reads a stored payload back; the shape `normalizeProposal` wrote. */
export function readPointsPayload(
  payload: AiSuggestionPayload,
): PointsSuggestionPayload {
  return {
    amount: amountOrNull(payload.amount) ?? 0,
    reason: reasonOrNull(payload.reason) ?? '',
    target_user_ids: memberIds(payload.target_user_ids),
    event_id:
      typeof payload.event_id === 'string' && UUID.test(payload.event_id)
        ? payload.event_id
        : null,
    ...eventLabel(payload),
  };
}

/**
 * The idempotency key of one member's adjustment under one suggestion: the
 * same suggestion and member always give the same key, so accepting again
 * after a failure part-way replays what landed instead of granting twice
 * (`PointsService.adjustPoints`, #1719). Shaped as a UUID because that is
 * what the ledger's other writers send.
 */
export function pointsSuggestionKey(
  suggestionId: string,
  targetUserId: string,
): string {
  const hex = createHash('sha256')
    .update(`ai-suggestion:${suggestionId}:${targetUserId}`)
    .digest('hex');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function incomplete(message: string): BadRequestException {
  return new BadRequestException({ code: 'ai.suggestion.incomplete', message });
}

/**
 * A proposed points change (#718: "give 5 points to everyone who came
 * tonight"). Accepting it adjusts each named member's points through
 * {@link PointsService.adjustPoints} as the officer who accepted, so every
 * rule of a manual adjustment holds for every member in it: the target must
 * be in this chapter, nobody adjusts their own points, the chapter's hourly
 * limit and its anomaly flag apply, each member gets the usual push, and
 * each row lands in the ledger under the officer's name. No chat card.
 *
 * **All or nothing against the hourly limit.** A proposal for more members
 * than the officer has adjustments left this hour is refused whole, before
 * anything is written, so "everyone who came" is never half-granted.
 */
@Injectable()
export class PointsSuggestionKind implements AiSuggestionKindHandler {
  private readonly logger = new Logger(PointsSuggestionKind.name);
  readonly kind = 'points' as const;
  readonly requiredPermission = SystemPermissions.POINTS_ADJUST;
  readonly module = 'points';
  readonly expiresAfterDays = POINTS_SUGGESTION_EXPIRY_DAYS;
  readonly pushCategory = 'points';

  constructor(private readonly points: PointsService) {}

  describeBatch(count: number): string {
    return count === 1
      ? '1 points change to review'
      : `${count} points changes to review`;
  }

  normalizeProposal(raw: unknown): AiSuggestionPayload | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const input = raw as Record<string, unknown>;
    const amount = amountOrNull(input.amount);
    const reason = reasonOrNull(input.reason);
    const targets = memberIds(input.target_user_ids);
    if (
      amount === null ||
      reason === null ||
      targets.length > POINTS_SUGGESTION_MAX_MEMBERS
    ) {
      return null;
    }
    return {
      amount,
      reason,
      target_user_ids: targets,
      event_id:
        typeof input.event_id === 'string' && UUID.test(input.event_id)
          ? input.event_id
          : null,
      ...eventLabel(input),
    };
  }

  applyEdits(
    payload: AiSuggestionPayload,
    edits: Record<string, unknown>,
  ): AiSuggestionPayload {
    const next = readPointsPayload(payload);
    const has = (key: string) => edits[key] !== undefined;
    if (has('amount')) {
      const amount = amountOrNull(edits.amount);
      if (amount === null) {
        throw new BadRequestException(
          `Points must be a whole number, not zero, up to ${POINTS_ADJUSTMENT_MAX}.`,
        );
      }
      next.amount = amount;
    }
    if (has('reason')) {
      const reason = reasonOrNull(edits.reason);
      if (reason === null) {
        throw new BadRequestException('A points change needs a reason.');
      }
      next.reason = reason;
    }
    if (has('target_user_ids')) {
      const targets = memberIds(edits.target_user_ids);
      if (targets.length > POINTS_SUGGESTION_MAX_MEMBERS) {
        throw new BadRequestException(
          `At most ${POINTS_SUGGESTION_MAX_MEMBERS} members at a time.`,
        );
      }
      next.target_user_ids = targets;
    }
    return { ...next };
  }

  assertAcceptable(payload: AiSuggestionPayload): void {
    const change = readPointsPayload(payload);
    if (change.amount === 0) throw incomplete('Say how many points.');
    if (!change.reason) throw incomplete('A points change needs a reason.');
    if (change.target_user_ids.length === 0) {
      throw incomplete('Pick at least one member.');
    }
  }

  async commit(input: {
    chapterId: string;
    userId: string;
    suggestionId: string;
    payload: AiSuggestionPayload;
  }): Promise<AiSuggestionCommitResult> {
    const change = readPointsPayload(input.payload);
    // Nobody adjusts their own points; the card already said so.
    const targets = change.target_user_ids.filter((id) => id !== input.userId);
    if (change.amount === 0 || !change.reason || targets.length === 0) {
      throw incomplete('Pick at least one member other than yourself.');
    }

    const budget = await this.points.adjustmentBudget(
      input.chapterId,
      input.userId,
    );
    if (targets.length > budget.remaining) {
      // A Confirm pressed again after a part-way failure: the members it
      // already changed replay for free, so only the rest need room.
      const landed = await this.points.landedKeys(
        input.chapterId,
        targets.map((id) => pointsSuggestionKey(input.suggestionId, id)),
      );
      const waiting = targets.length - landed.size;
      if (waiting > budget.remaining) {
        throw new HttpException(
          {
            code: 'ai.suggestion.points.over_limit',
            message:
              budget.used === 0
                ? `This changes points for ${targets.length} members, and your chapter allows ${budget.limit} point adjustments an hour. Take some members off, or raise the limit in Points settings.`
                : `This changes points for ${waiting} members, and you have ${budget.remaining} of your chapter's ${budget.limit} point adjustments left this hour. Take some members off, or try again later.`,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    let firstId: string | null = null;
    let adjusted = 0;
    let skipped = 0;
    let failed = 0;
    let firstFailure: unknown = null;
    const queue = [...targets];
    const work = async () => {
      for (;;) {
        const targetUserId = queue.shift();
        if (targetUserId === undefined) return;
        try {
          const txn = await this.points.adjustPoints({
            chapterId: input.chapterId,
            targetUserId,
            adminUserId: input.userId,
            amount: change.amount,
            category: 'MANUAL',
            reason: change.reason,
            clientMessageId: pointsSuggestionKey(
              input.suggestionId,
              targetUserId,
            ),
          });
          adjusted += 1;
          firstId ??= txn.id;
        } catch (error) {
          // A member who left since the card was drawn, or (a race) the
          // officer themself: left out and counted. Anything else is a
          // failure, thrown below once every member has been tried.
          if (
            !(error instanceof NotFoundException) &&
            !(error instanceof ForbiddenException)
          ) {
            firstFailure ??= error;
            failed += 1;
            continue;
          }
          skipped += 1;
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(COMMIT_CONCURRENCY, targets.length) },
        work,
      ),
    );

    if (failed > 0) {
      // Never reported as done, and never blamed on members having left: the
      // suggestion goes back to waiting, and pressing Confirm again changes
      // only the members this run missed (each has its own idempotency key).
      this.logger.warn(
        `Points proposal ${input.suggestionId}: ${failed} of ${targets.length} adjustments failed (${
          firstFailure instanceof HttpException
            ? firstFailure.getStatus()
            : 'error'
        }); left waiting`,
      );
      if (adjusted === 0) {
        throw firstFailure instanceof Error
          ? firstFailure
          : new Error('The points change failed.');
      }
      throw new HttpException(
        {
          code: 'ai.suggestion.points.partial',
          message: `${adjusted} of ${targets.length} members got their points and the rest did not go through. Confirm again to finish: nobody is changed twice.`,
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (firstId === null) {
      throw new NotFoundException({
        code: 'ai.suggestion.points.no_members',
        message: 'None of these members are in the chapter any more.',
      });
    }
    return { resultId: firstId, outcome: { adjusted, skipped } };
  }
}
