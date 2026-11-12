import { TASK_TITLE_MAX_LENGTH } from '@repo/validation';
import {
  actionItemKey,
  actionItemsText,
  taskProposalsFromMinutes,
} from './minutes-task-proposals';

const JAKE = '11111111-1111-4111-8111-111111111111';

const minutes = (action_items: unknown[]) => ({ summary: '', action_items });

describe('taskProposalsFromMinutes (#4313)', () => {
  it('makes one proposal per action item, with its owner and day as posted', () => {
    const proposals = taskProposalsFromMinutes(
      minutes([
        { text: 'Book the bus', owner_user_id: JAKE, due_date: '2026-11-14' },
        { text: 'Order shirts', owner_user_id: null, due_date: null },
      ]),
      'Chapter meeting',
    );

    expect(proposals).toEqual([
      {
        dedupeKey: actionItemKey('Book the bus'),
        payload: {
          title: 'Book the bus',
          description: 'From the minutes of Chapter meeting.',
          assignee_id: JAKE,
          due_date: '2026-11-14',
        },
        quote: 'Book the bus',
      },
      {
        dedupeKey: actionItemKey('Order shirts'),
        payload: {
          title: 'Order shirts',
          description: 'From the minutes of Chapter meeting.',
          // Nobody named: the officer picks. Never a guess.
          assignee_id: null,
          due_date: null,
        },
        quote: 'Order shirts',
      },
    ]);
  });

  it('never carries points, even when the item is an award of them', () => {
    const [proposal] = taskProposalsFromMinutes(
      minutes([
        { text: 'Give Jake 50 points', owner_user_id: null, due_date: null },
      ]),
      'Chapter meeting',
    );
    expect(Object.keys(proposal.payload).sort()).toEqual([
      'assignee_id',
      'description',
      'due_date',
      'title',
    ]);
  });

  it('proposes two items with the same words once', () => {
    const proposals = taskProposalsFromMinutes(
      minutes([
        { text: 'Book the bus', owner_user_id: JAKE, due_date: null },
        { text: 'book the bus.', owner_user_id: null, due_date: null },
      ]),
      'Chapter meeting',
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0].payload.assignee_id).toBe(JAKE);
  });

  it('cuts a long item to a title the task form takes, and keeps the whole line', () => {
    const text = `${'Call every alumnus on the list '.repeat(12)}before Friday`;
    const [proposal] = taskProposalsFromMinutes(
      minutes([{ text, owner_user_id: null, due_date: null }]),
      'Exec meeting',
    );
    expect(proposal.payload.title.length).toBeLessThanOrEqual(
      TASK_TITLE_MAX_LENGTH,
    );
    expect(proposal.payload.title.endsWith('…')).toBe(true);
    expect(proposal.payload.description).toBe(
      `${text}\n\nFrom the minutes of Exec meeting.`,
    );
    expect(proposal.quote).toBe(text);
  });

  it('proposes nothing for minutes with no action items, or a shape it cannot read', () => {
    expect(taskProposalsFromMinutes(minutes([]), 'Chapter meeting')).toEqual(
      [],
    );
    expect(taskProposalsFromMinutes(null, 'Chapter meeting')).toEqual([]);
    expect(
      taskProposalsFromMinutes(
        minutes([{ text: '...', owner_user_id: null, due_date: null }]),
        'Chapter meeting',
      ),
    ).toEqual([]);
  });

  it('checks every quote against the action items, word for word', () => {
    const content = minutes([
      { text: ' Book the bus ', owner_user_id: null, due_date: null },
      { text: 'Order shirts', owner_user_id: null, due_date: null },
    ]);
    const text = actionItemsText(content);
    for (const proposal of taskProposalsFromMinutes(content, 'Chapter')) {
      expect(text).toContain(proposal.quote);
    }
  });
});

describe('actionItemKey', () => {
  it('is the same for a fix to capitals, spacing or punctuation', () => {
    expect(actionItemKey('Book the bus.')).toBe(actionItemKey('book  the bus'));
  });

  it('differs when the words do', () => {
    expect(actionItemKey('Book the bus')).not.toBe(
      actionItemKey('Book the van'),
    );
  });

  it('holds none of the words', () => {
    expect(actionItemKey('Book the bus')).toMatch(/^[0-9a-f]{32}$/);
  });
});
