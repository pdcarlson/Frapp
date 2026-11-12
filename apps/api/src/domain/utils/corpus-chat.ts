import {
  CORPUS_CHUNK_MAX_CHARS,
  CORPUS_CHUNK_TARGET_CHARS,
  chunkSections,
  normalizeCorpusText,
} from './corpus-chunker';

/**
 * Chat in the AI corpus (#4314, `spec/behavior/ai.md` § Chat as a source):
 * how a conversation window becomes passages. Pure, so the indexer and the
 * eval harness build windows with the same code.
 */

/** One message of a window, as the window read returns it. */
export interface ChatWindowMessage {
  id: string;
  /** Null for an imported Discord row nobody linked: no author to have said yes. */
  senderId: string | null;
  /** The author's display name when the window was read. */
  senderName: string;
  content: string;
  createdAt: string;
  /** Set on a thread reply: the message it answers. */
  threadRootId: string | null;
  /** When its conversation started: its root's time for a reply, else its own. */
  conversationAt: string;
}

export interface ChatWindowInput {
  /** The channel's name without the `#`. */
  channelName: string;
  /** `YYYY-MM-DD`: the window's day. */
  day: string;
  /** Oldest conversation first, each thread's replies right after their root. */
  messages: readonly ChatWindowMessage[];
}

/** A passage of chat: text plus who wrote it and where it starts. */
export interface ChatPassageDraft {
  heading: string;
  content: string;
  /** Every member with a message in the passage. */
  authorIds: string[];
  /** The passage's first message: the one a citation opens. */
  anchorId: string;
  anchorAt: string;
  messageCount: number;
}

export interface ChatWindowBuild {
  passages: ChatPassageDraft[];
  /** How many messages were left out because their author had not said yes. */
  leftOutCount: number;
  /** Who they were. Never shown to anyone; used to bring the window back. */
  leftOutAuthorIds: string[];
  /** The window's first included message's time, or null when none is. */
  firstAt: string | null;
}

/**
 * A pause this long between two messages starts a new passage: the
 * conversation moved on. A thread's replies count from their root, so a
 * thread stays with the message it answers however late it was replied to.
 */
export const CHAT_CONVERSATION_GAP_MS = 45 * 60_000;

/** The name a passage gives an author with no display name. */
const UNNAMED_AUTHOR = 'A member';

/**
 * "November 9, 2026": what a chat passage sits under. The channel is the
 * source's title, so the embedded text reads "#general › November 9, 2026".
 */
export function chatPassageHeading(day: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${day}T12:00:00Z`));
}

/** What a chat source is called: the channel, with its `#`. */
export function chatSourceTitle(channelName: string): string {
  return `#${channelName}`;
}

/**
 * One message as a line of a passage. The author's name is part of the text
 * so a passage reads as the conversation did ("Sam: who has the van keys?",
 * "Lee: I do"); a reply says it is one.
 */
function lineOf(message: ChatWindowMessage): string {
  const name = message.senderName.trim() || UNNAMED_AUTHOR;
  const text = normalizeCorpusText(message.content).replace(/\n{2,}/g, '\n');
  return message.threadRootId
    ? `${name}, replying in a thread: ${text}`
    : `${name}: ${text}`;
}

/**
 * The window as passages, keeping only messages whose author is in
 * `consentingAuthors` (`AiConsentService.chatAuthorsWhoSaidYes`).
 *
 * A message whose author has not said yes is left out, never the passage
 * around it: the window is rebuilt without it, and it is counted. A passage
 * is a run of messages with no long pause, about the size of a document's
 * passage; one message too long for a passage is cut on its own.
 */
export function buildChatWindowChunks(
  window: ChatWindowInput,
  consentingAuthors: ReadonlySet<string>,
): ChatWindowBuild {
  const heading = chatPassageHeading(window.day);
  const passages: ChatPassageDraft[] = [];
  const leftOutAuthors = new Set<string>();
  let leftOutCount = 0;
  let firstAt: string | null = null;

  let lines: string[] = [];
  let length = 0;
  let authors = new Set<string>();
  let anchor: ChatWindowMessage | null = null;
  let count = 0;
  let lastConversationAt: number | null = null;

  const close = () => {
    if (anchor && lines.length > 0) {
      passages.push({
        heading,
        content: lines.join('\n'),
        authorIds: [...authors],
        anchorId: anchor.id,
        anchorAt: anchor.createdAt,
        messageCount: count,
      });
    }
    lines = [];
    length = 0;
    authors = new Set();
    anchor = null;
    count = 0;
  };

  for (const message of window.messages) {
    if (message.senderId === null || !consentingAuthors.has(message.senderId)) {
      leftOutCount += 1;
      if (message.senderId !== null) leftOutAuthors.add(message.senderId);
      continue;
    }
    const senderId = message.senderId;
    const line = lineOf(message);
    if (!line.trim()) continue;
    firstAt ??= message.createdAt;

    const at = Date.parse(message.conversationAt);
    if (
      lastConversationAt !== null &&
      at - lastConversationAt > CHAT_CONVERSATION_GAP_MS
    ) {
      close();
    }
    lastConversationAt = Math.max(lastConversationAt ?? at, at);

    if (line.length > CORPUS_CHUNK_MAX_CHARS) {
      // A message longer than a passage: its own passages, cut where the
      // document chunker would cut it.
      close();
      for (const piece of chunkSections([
        { heading, page: null, text: line },
      ])) {
        passages.push({
          heading,
          content: piece.content,
          authorIds: [senderId],
          anchorId: message.id,
          anchorAt: message.createdAt,
          messageCount: 1,
        });
      }
      continue;
    }

    if (length > 0 && length + 1 + line.length > CORPUS_CHUNK_MAX_CHARS) {
      close();
    }
    anchor ??= message;
    lines.push(line);
    length += (length > 0 ? 1 : 0) + line.length;
    authors.add(senderId);
    count += 1;
    if (length >= CORPUS_CHUNK_TARGET_CHARS) close();
  }
  close();

  return {
    passages,
    leftOutCount,
    leftOutAuthorIds: [...leftOutAuthors],
    firstAt,
  };
}

/** The sentence an answer carries when messages were left out. Never whose. */
export function chatLeftOutNotice(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? "1 message from a member who opted out isn't included."
    : `${count} messages from members who opted out aren't included.`;
}
