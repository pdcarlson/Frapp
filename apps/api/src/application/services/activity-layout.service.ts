import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  ACTIVITY_CARD_KEY_PATTERN,
  ACTIVITY_LAYOUT_MAX_KEYS,
} from '@repo/validation';
import {
  ACTIVITY_LAYOUT_REPOSITORY,
  type ActivityLayoutLists,
  type IActivityLayoutRepository,
} from '#domain/repositories/activity-layout.repository.interface';

/** What every `/v1/activity/layout` route that answers with a body returns. */
export interface ActivityLayoutView {
  /** The cards shown, top to bottom. Empty when nothing is saved. */
  card_order: string[];
  /** The cards the member hid. Empty when nothing is saved. */
  hidden_cards: string[];
  /**
   * Whether the member has saved an arrangement. False means the client shows
   * the default for the member's role, which the client owns.
   */
  saved: boolean;
}

/**
 * A member's own arrangement of their Activity cards (#5520), per
 * `spec/behavior/activity.md` § Cards: the order of the cards they show and
 * which they hid, per chapter, synced between phone and web.
 *
 * **What the server decides, and what it leaves to the clients.** The server
 * stores the two lists and holds them to the key grammar. It does not know
 * which cards exist or what a role's default is: it accepts any well-formed
 * key, so a newer client can save a card this API was built before, and each
 * client drops a key it doesn't know and places a card it knows but the row
 * doesn't name.
 *
 * No route or method takes a user id from the caller; the owner is always the
 * authenticated member, so nobody, an officer included, can read or change
 * another member's arrangement.
 */
@Injectable()
export class ActivityLayoutService {
  constructor(
    @Inject(ACTIVITY_LAYOUT_REPOSITORY)
    private readonly layouts: IActivityLayoutRepository,
  ) {}

  /** The member's saved arrangement, or empty lists and `saved: false`. */
  async get(chapterId: string, userId: string): Promise<ActivityLayoutView> {
    const row = await this.layouts.find(chapterId, userId);
    if (!row) return { card_order: [], hidden_cards: [], saved: false };
    return {
      card_order: row.card_order,
      hidden_cards: row.hidden_cards,
      saved: true,
    };
  }

  /**
   * Replace the member's arrangement. Every key must be well formed, each list
   * hold at most {@link ACTIVITY_LAYOUT_MAX_KEYS}, and no key may appear twice,
   * in one list or across both: a card is either shown in one place or hidden.
   * The DTO checks the first two as well; this is the rule wherever it's
   * called from.
   */
  async save(
    chapterId: string,
    userId: string,
    body: ActivityLayoutLists,
  ): Promise<ActivityLayoutView> {
    const lists = {
      card_order: body.card_order,
      hidden_cards: body.hidden_cards,
    };
    assertValidLayout(lists);
    const row = await this.layouts.upsert(chapterId, userId, lists);
    return {
      card_order: row.card_order,
      hidden_cards: row.hidden_cards,
      saved: true,
    };
  }

  /** Back to the role's default. Idempotent. */
  async reset(chapterId: string, userId: string): Promise<void> {
    await this.layouts.delete(chapterId, userId);
  }
}

function assertValidLayout(lists: ActivityLayoutLists): void {
  const seen = new Set<string>();
  for (const [name, keys] of [
    ['card_order', lists.card_order],
    ['hidden_cards', lists.hidden_cards],
  ] as const) {
    if (!Array.isArray(keys)) {
      throw new BadRequestException(`${name} must be a list of card keys.`);
    }
    if (keys.length > ACTIVITY_LAYOUT_MAX_KEYS) {
      throw new BadRequestException(
        `${name} can hold at most ${ACTIVITY_LAYOUT_MAX_KEYS} cards.`,
      );
    }
    for (const key of keys) {
      if (typeof key !== 'string' || !ACTIVITY_CARD_KEY_PATTERN.test(key)) {
        throw new BadRequestException(
          `${name} has a card key that isn't lower-case words joined by hyphens.`,
        );
      }
      if (seen.has(key)) {
        throw new BadRequestException(
          `The card "${key}" is listed more than once.`,
        );
      }
      seen.add(key);
    }
  }
}
