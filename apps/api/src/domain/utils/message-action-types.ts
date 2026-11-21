import { CARD_VOTE_ACTION_TYPE } from './poll-vote-rules';
import { SIGNUP_ACTION_TYPE } from './signup-card-rules';

/**
 * The `action_type`s `POST /v1/channels/messages/:messageId/actions` takes,
 * which are the three the apps send (`@repo/chat-core`): an emoji reaction
 * (`reaction:<emoji>`), a vote on a poll card ({@link CARD_VOTE_ACTION_TYPE})
 * and a claim on a sign-up card ({@link SIGNUP_ACTION_TYPE}).
 *
 * Every row lands in `chat_message_actions`, which every reader of the
 * channel loads with the message, so an action type nothing draws would be
 * stored and served for nothing.
 */

/** The prefix every emoji reaction's `action_type` carries (`reaction:<emoji>`). */
export const REACTION_ACTION_PREFIX = 'reaction:';

/**
 * A known action type: `vote`, `signup`, or `reaction:` and the emoji, which
 * holds no whitespace. The DTO's length cap bounds the emoji.
 */
export const MESSAGE_ACTION_TYPE_PATTERN = new RegExp(
  `^(?:${CARD_VOTE_ACTION_TYPE}|${SIGNUP_ACTION_TYPE}|${REACTION_ACTION_PREFIX}\\S+)$`,
  'u',
);

/** Whether an action is an emoji reaction. */
export function isReactionActionType(actionType: string): boolean {
  return actionType.startsWith(REACTION_ACTION_PREFIX);
}

/**
 * The most a message action's `payload` may hold, serialized (JSON text
 * length). The largest the apps send is a sign-up claim with every slot of a
 * full card and the longest answer note, about 900 characters; a vote names
 * at most ten options. A reaction carries none.
 */
export const MESSAGE_ACTION_PAYLOAD_MAX_CHARS = 4_096;
