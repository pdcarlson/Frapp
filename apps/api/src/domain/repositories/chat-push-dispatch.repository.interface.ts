export const CHAT_PUSH_DISPATCH_REPOSITORY = 'CHAT_PUSH_DISPATCH_REPOSITORY';

/**
 * How one claim attempt ended.
 *
 * - `claimed`: this instance inserted the row and owns the message's fan-out.
 * - `taken`: another instance (or an earlier delivery) already owns it.
 * - `gone`: the message was hard-deleted before the claim; nothing to send.
 * - `failed`: the insert failed for another reason, already logged.
 */
export type ChatPushClaimOutcome = 'claimed' | 'taken' | 'gone' | 'failed';

/**
 * The push worker's cross-instance claim (#2846). Every API instance receives
 * every `chat_messages` INSERT from Realtime; the primary key on
 * `chat_push_dispatches` is what lets exactly one of them send.
 */
export interface IChatPushDispatchRepository {
  /** Claim the right to fan out one message. Only `claimed` may send. */
  claim(messageId: string): Promise<ChatPushClaimOutcome>;
  /** Delete claims made before `cutoff`, returning how many went. Throws on a failed delete. */
  purgeBefore(cutoff: Date): Promise<number>;
}
