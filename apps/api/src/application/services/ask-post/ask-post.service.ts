import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  ASK_ANSWER_KIND,
  ASK_POST_MAX_AGE_MS,
  ASK_POST_REFUSALS,
  ASK_POSTED_ANSWER_VERSION,
  type AskPostedAnswer,
  type AskPostOutcome,
  type AskPostRefusalCode,
  type AskPostRestricted,
} from '@repo/validation';
import { aiStoredTextKeyRing } from '../../../config/ai-stored-text-config';
import { SYSTEM_SENDER_ID } from '#domain/constants/chat';
import { SystemPermissions } from '#domain/constants/permissions';
import { CHAT_MESSAGE_REPOSITORY } from '#domain/repositories/chat.repository.interface';
import type { IChatMessageRepository } from '#domain/repositories/chat.repository.interface';
import {
  AskReportReceiptError,
  openAskReportReceipt,
  type AskGivenRef,
  type AskReportReceipt,
} from '#domain/utils/ai-report-receipt';
import { AiTextCipherError } from '#domain/utils/ai-text-cipher';
import { aiCatalogEntry } from '#domain/constants/ai-model-catalog';
import { aiConsentRefusal } from '../ai/ai-consent-refusal';
import { AiConsentService } from '../ai/ai-consent.service';
import { ASK_ANSWER_PROMPT_VERSION } from '../ask/ask-prompt';
import { ChannelAccessService } from '../channel-access.service';
import { MeetingService } from '../meeting.service';
import { EventService } from '../event.service';
import type { ChapterMemberAccess } from '../rbac.service';

/**
 * Posts an Ask Frapp answer to a channel (#4713, `spec/behavior/ai.md`
 * § Posting an answer to the channel).
 *
 * The one place an answer leaves its asker. Ask itself still posts nothing
 * (`ask-posts-nothing.spec.ts` holds `services/ask/` to that): this service
 * is outside it, calls no model, and writes exactly one row.
 *
 * **What it posts is what the server sent.** The answer comes from the
 * receipt the server sealed into it for this member in this chapter
 * (`ai-report-receipt.ts`), never from text in the request, so a posted
 * answer is one Frapp wrote and showed, with the sources it had.
 *
 * **Paul's rule (decision 2026-11-13): what the asker can open, with a
 * warning.** The answer may draw on anything its asker could read. Before
 * it is posted, each thing the model was handed is checked against everyone
 * who can read the channel now, and the asker is shown what not all of them
 * could open. They post only by accepting that list: `acknowledged` must
 * name every entry, and the check runs again on the post itself, so a list
 * that grew in between is shown again instead of posted past.
 *
 * Three things never go to a channel: an answer that read chat messages
 * (their authors chose their own channel's audience, not this one), an
 * answer to a follow-up (the model also read the earlier turns, which the
 * client sent and no check can trace), and a request or its card, which has
 * no receipt.
 *
 * The row is the Frapp sender's, of kind `ask_answer`. It is written with no
 * mentions and the push worker returns on the kind, so it notifies nobody.
 */
@Injectable()
export class AskPostService {
  constructor(
    private readonly consent: AiConsentService,
    private readonly channelAccess: ChannelAccessService,
    private readonly meetings: MeetingService,
    private readonly events: EventService,
    @Inject(CHAT_MESSAGE_REPOSITORY)
    private readonly messageRepo: IChatMessageRepository,
  ) {}

  async post(input: {
    chapterId: string;
    userId: string;
    channelId: string;
    receipt: string;
    confirm: boolean;
    acknowledged: readonly string[];
    now: Date;
  }): Promise<AskPostOutcome> {
    // What asking checks, checked again (`AskService.assertMayAsk`): the
    // president may have turned Ask off, or the member said No to Frapp AI,
    // since the answer was written, and neither should still put an AI
    // answer in a channel.
    const entry = aiCatalogEntry('ask.answer');
    const decision = await this.consent.check({
      chapterId: input.chapterId,
      actingUserId: input.userId,
      task: 'ask.answer',
      family: entry.family,
      provider: entry.provider,
      model: entry.model,
      promptVersion: ASK_ANSWER_PROMPT_VERSION,
    });
    if (!decision.allowed) throw aiConsentRefusal(decision.reason);

    const receipt = this.open(input);
    const { shown, given } = receipt;
    if (shown.status !== 'answered' || shown.text.trim() === '') {
      throw refusal('ai.ask.post.not_an_answer');
    }
    // A receipt sealed before sources carried where they came from can be
    // reported but not checked against an audience.
    if (
      given.some((source) => !source.ref) ||
      shown.sources.some((source) => source.target === undefined) ||
      input.now.getTime() - Date.parse(receipt.issued_at) > ASK_POST_MAX_AGE_MS
    ) {
      throw refusal('ai.ask.post.too_old');
    }
    if (given.some((source) => source.ref?.type === 'chat')) {
      throw refusal('ai.ask.post.read_chat');
    }
    // Earlier turns were the client's text and the model read them too, so
    // the audience check below could not cover what the answer rests on.
    if (receipt.followed_up) throw refusal('ai.ask.post.follow_up');

    // The asker must be able to post here themselves: a read-only channel,
    // an archived one and the audit log refuse as they do a message.
    const channel = await this.channelAccess.assertChannelAccess(
      input.channelId,
      input.chapterId,
      input.userId,
      'post',
    );
    // The asker could open everything by construction; the question is
    // everyone else who reads the channel.
    const others = (
      await this.channelAccess.channelReaders(channel, input.chapterId)
    ).filter((reader) => reader.user_id !== input.userId);
    const restricted = await this.restrictedFor(
      input.chapterId,
      receipt,
      others,
    );

    const acknowledged = new Set(input.acknowledged);
    if (
      !input.confirm ||
      restricted.some(({ key }) => !acknowledged.has(key))
    ) {
      return { posted: false, restricted };
    }

    const limited = new Set(restricted.map(({ key }) => key));
    // A live read's chip opens a page, which names no single read, so a
    // chip is matched to the read behind it by the title they share.
    const reads = new Map(
      given.flatMap(({ ref, label }) =>
        ref?.type === 'tool' && label ? [[label, ref] as const] : [],
      ),
    );
    const payload: AskPostedAnswer = {
      v: ASK_POSTED_ANSWER_VERSION,
      ask_id: receipt.ask_id,
      asked_by: input.userId,
      question: receipt.question,
      // Where each marker goes and which source it names. The quoted words
      // stay with the asker: a reader who can't open a source is shown its
      // name, not a passage of it.
      citations: shown.citations.map(({ source, at }) => ({ source, at })),
      sources: shown.sources.map((source) => {
        const read = reads.get(source.title);
        const own = read?.reach === 'asker';
        const target = (source.target ??
          null) as AskPostedAnswer['sources'][number]['target'];
        const key = read ? `tool:${read.name}` : targetKey(target);
        return {
          kind: source.kind,
          title: source.title,
          detail: source.detail,
          date: source.date,
          // A reader's Tasks page is their own, not the asker's.
          target: own ? null : target,
          ...(own ? { own: true } : {}),
          ...(limited.has(key) ? { limited: true } : {}),
        };
      }),
      ...(shown.truncated ? { truncated: true } : {}),
    };
    // One row a channel, keyed on the ask, so a second tap or a retried
    // request posts nothing more there. `content` is the answer alone: a citation's offset
    // counts into it, and a build from before this kind shows it as text.
    const written = await this.messageRepo.insertIdempotent({
      channel_id: channel.id,
      sender_id: SYSTEM_SENDER_ID,
      type: 'TEXT',
      kind: ASK_ANSWER_KIND,
      content: shown.text,
      payload,
      client_message_id: `ask:${receipt.ask_id}`,
    });
    // The row was already there, live or deleted (a deleted message keeps
    // its key). Saying "posted" would take the asker's copy away and show
    // them nothing new.
    if (written === 'duplicate') throw refusal('ai.ask.post.already_posted');
    return { posted: true, restricted };
  }

  /** Opens the answer's receipt, or refuses in the words a member can act on. */
  private open(input: {
    chapterId: string;
    userId: string;
    receipt: string;
    now: Date;
  }): AskReportReceipt {
    try {
      return openAskReportReceipt(
        aiStoredTextKeyRing(),
        input.receipt,
        { chapterId: input.chapterId, userId: input.userId },
        input.now,
      );
    } catch (error) {
      if (error instanceof AskReportReceiptError) {
        throw refusal(
          error.reason === 'expired'
            ? 'ai.ask.post.too_old'
            : 'ai.ask.post.receipt_invalid',
        );
      }
      // No key on this server: it sealed no receipt, so this one is not its.
      if (error instanceof AiTextCipherError && error.reason === 'no_key') {
        throw refusal('ai.ask.post.receipt_invalid');
      }
      throw error;
    }
  }

  /**
   * Of everything the model was handed, what not every one of `others` could
   * open. Handed, not cited: an answer can rest on a source it never names.
   * Each kind is asked through the rule its own read route uses.
   */
  private async restrictedFor(
    chapterId: string,
    receipt: AskReportReceipt,
    others: readonly ChapterMemberAccess[],
  ): Promise<AskPostRestricted[]> {
    if (others.length === 0) return [];
    const given = receipt.given.flatMap((source) =>
      source.ref
        ? [
            {
              ref: source.ref,
              title: source.label ?? source.title,
              kind: source.kind ?? 'document',
            },
          ]
        : [],
    );
    const idsOf = (type: 'document' | 'meeting') => [
      ...new Set(
        given.flatMap(({ ref }) => (ref.type === type ? [ref.id] : [])),
      ),
    ];
    const eventIds = [
      ...new Set(
        given.flatMap(({ ref }) =>
          ref.type === 'tool' && ref.reach === 'events'
            ? (ref.events ?? [])
            : [],
        ),
      ),
    ];
    const [readableMinutes, openEvents] = await Promise.all([
      this.meetings.readableByAll(chapterId, idsOf('meeting'), others),
      this.events.visibleToAll(eventIds, chapterId, others),
    ]);
    // Documents, the roster, the standings and the calendar are read through
    // `members:view`, the permission Ask's own reads require.
    const allViewMembers = others.every(
      ({ permissions }) =>
        permissions.has(SystemPermissions.WILDCARD) ||
        permissions.has(SystemPermissions.MEMBERS_VIEW),
    );
    const open = (ref: AskGivenRef): boolean => {
      switch (ref.type) {
        case 'document':
          return allViewMembers;
        case 'meeting':
          // The minutes routes ask for `members:view` before the meeting's
          // own rule (`MeetingController`).
          return allViewMembers && readableMinutes.has(ref.id);
        case 'tool':
          if (ref.reach === 'asker') return false;
          if (!allViewMembers) return false;
          return (
            ref.reach === 'chapter' ||
            (ref.events ?? []).every((id) => openEvents.has(id))
          );
        default:
          // Chat was refused before this; anything else has no rule here,
          // and what can't be checked is never called open.
          return false;
      }
    };
    const restricted = new Map<string, AskPostRestricted>();
    for (const [index, { ref, title, kind }] of given.entries()) {
      if (open(ref)) continue;
      const key = givenKey(ref, index);
      if (!restricted.has(key)) restricted.set(key, { key, kind, title });
    }
    return [...restricted.values()];
  }
}

function refusal(code: AskPostRefusalCode): BadRequestException {
  return new BadRequestException({ code, message: ASK_POST_REFUSALS[code] });
}

/** A handed source's key: the same for every passage of one document. */
function givenKey(ref: AskGivenRef, index: number): string {
  switch (ref.type) {
    case 'document':
    case 'meeting':
      return `${ref.type}:${ref.id}`;
    case 'tool':
      return `tool:${ref.name}`;
    default:
      return `${ref.type}:${index}`;
  }
}

/** The key of the document or minutes a shown chip opens, or none. */
function targetKey(
  target: { type: string; document_id?: unknown; meeting_id?: unknown } | null,
): string {
  if (target?.type === 'document' && typeof target.document_id === 'string') {
    return `document:${target.document_id}`;
  }
  if (target?.type === 'meeting' && typeof target.meeting_id === 'string') {
    return `meeting:${target.meeting_id}`;
  }
  return '';
}
