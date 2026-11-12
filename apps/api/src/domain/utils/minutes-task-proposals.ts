import { createHash } from 'node:crypto';
import {
  TASK_TITLE_MAX_LENGTH,
  readMeetingContent,
  type MeetingActionItem,
} from '@repo/validation';

/**
 * Suggested tasks from posted minutes (#4313, `spec/behavior/meetings.md`
 * § Suggested tasks).
 *
 * No model is called. By the time minutes are posted, each action item is
 * already structured (its text, an owner only when one was named, a due date
 * only when one was said), either typed by the officer or drafted from their
 * notes and checked line by line (`minutes-draft.ts`), and the officer has
 * read it. A second model call could only reword it, and would add a cost, a
 * consent question, a way to fail and a second place for a line in the notes
 * to be followed as an instruction. So a proposal is the action item, as
 * posted: the same owner, the same day, and never points.
 */

export interface MinutesTaskProposal {
  /**
   * Which action item this is, within its minutes: a fingerprint of its
   * words, not the words. The same item is never proposed twice, whatever
   * became of the first proposal.
   */
  dedupeKey: string;
  payload: {
    title: string;
    description: string | null;
    assignee_id: string | null;
    due_date: string | null;
  };
  /** The action item as the minutes write it: where the task came from. */
  quote: string;
}

/**
 * The same item after a fix to its capitals, spacing or punctuation is still
 * the same item, so an officer who tidies posted minutes is not asked about
 * a task twice.
 */
export function actionItemKey(text: string): string {
  const normalized = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}

/** A title the task form would take: cut at a word when the item runs long. */
function titleFrom(text: string): string {
  if (text.length <= TASK_TITLE_MAX_LENGTH) return text;
  const cut = text.slice(0, TASK_TITLE_MAX_LENGTH - 1);
  const atWord = cut.replace(/\s+\S*$/, '');
  return `${(atWord.length > TASK_TITLE_MAX_LENGTH / 2 ? atWord : cut).trimEnd()}…`;
}

function descriptionFrom(text: string, title: string, meetingName: string) {
  const from = `From the minutes of ${meetingName}.`;
  // A title that had to be cut keeps its whole line in the description.
  return title === text ? from : `${text}\n\n${from}`;
}

/**
 * One proposal per action item of these minutes, in their order. Two items
 * with the same words are one proposal (the first).
 */
export function taskProposalsFromMinutes(
  content: unknown,
  meetingName: string,
): MinutesTaskProposal[] {
  const seen = new Set<string>();
  const proposals: MinutesTaskProposal[] = [];
  for (const item of readMeetingContent(content).action_items) {
    const text = item.text.trim();
    const dedupeKey = actionItemKey(text);
    // An item of only punctuation names nothing to do.
    if (!text || dedupeKey === actionItemKey('') || seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    const title = titleFrom(text);
    proposals.push({
      dedupeKey,
      payload: {
        title,
        description: descriptionFrom(text, title, meetingName),
        assignee_id: item.owner_user_id,
        due_date: item.due_date,
      },
      quote: text,
    });
  }
  return proposals;
}

/** The text the quotes are checked against: the action items, one a line. */
export function actionItemsText(content: unknown): string {
  return readMeetingContent(content)
    .action_items.map((item: MeetingActionItem) => item.text.trim())
    .join('\n');
}
