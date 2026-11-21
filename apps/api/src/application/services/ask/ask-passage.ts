import type { AskSourceTarget } from '@repo/validation';
import { CHAT_SOURCE_TYPE } from '../corpus/chat-message-corpus-source';
import type { CorpusPassage } from '../corpus/corpus-retrieval.service';

/** A retrieved passage's kind, as a source chip names it. */
const SOURCE_KIND: Readonly<Record<string, string>> = {
  chapter_document: 'document',
  meeting_minutes: 'minutes',
  [CHAT_SOURCE_TYPE]: 'chat',
};

export function passageKind(passage: CorpusPassage): string {
  return SOURCE_KIND[passage.sourceType] ?? passage.sourceType;
}

export function passageIsChat(passage: CorpusPassage): boolean {
  return passage.sourceType === CHAT_SOURCE_TYPE;
}

/** The section and pages a passage sits on, when its source has them. */
export function passageDetail(passage: CorpusPassage): string | null {
  const page =
    passage.pageStart === null
      ? null
      : passage.pageEnd !== null && passage.pageEnd !== passage.pageStart
        ? `pages ${passage.pageStart} to ${passage.pageEnd}`
        : `page ${passage.pageStart}`;
  return [passage.heading, page].filter(Boolean).join(', ') || null;
}

/** Where a citation of the passage opens. */
export function passageTarget(passage: CorpusPassage): AskSourceTarget | null {
  if (passage.sourceType === 'chapter_document') {
    return {
      type: 'document',
      document_id: passage.sourceId,
      page: passage.pageStart,
    };
  }
  if (passage.sourceType === 'meeting_minutes') {
    return { type: 'meeting', meeting_id: passage.sourceId };
  }
  if (passageIsChat(passage) && passage.channelId && passage.messageId) {
    return {
      type: 'message',
      channel_id: passage.channelId,
      message_id: passage.messageId,
    };
  }
  return null;
}
