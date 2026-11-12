import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AI_RUN_FAILURE_REASONS,
  AI_RUN_STATUSES,
} from '../entities/ai-run.entity';
import {
  aiRunFailureMessage,
  aiRunRetryDelayMs,
  isAiEnabled,
  isAiRunRef,
} from './ai-runs';

const UUID = '0a000000-0000-4000-8000-000000004310';

const MIGRATION = readFileSync(
  join(
    __dirname,
    '../../../../../supabase/migrations/20261112020000_ai_runs.sql',
  ),
  'utf8',
);

/** The quoted values of a `check (<column> in (...))` in the migration. */
function checkList(column: string): string[] {
  const body = new RegExp(`check \\(${column} in \\(([\\s\\S]*?)\\)\\)`).exec(
    MIGRATION,
  )?.[1];
  if (!body) throw new Error(`no check list for ${column}`);
  return [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe('isAiEnabled', () => {
  it.each([
    ['1', true],
    ['true', true],
    [undefined, false],
    ['', false],
    ['0', false],
    ['false', false],
    ['yes', false],
    ['TRUE', false],
  ])('AI_ENABLED=%p is %p', (value, expected) => {
    expect(isAiEnabled({ AI_ENABLED: value })).toBe(expected);
  });
});

describe('isAiRunRef', () => {
  it('takes ids, counts, flags and lists of them', () => {
    expect(
      isAiRunRef({
        meeting_id: UUID,
        attendee_ids: [UUID, UUID],
        message_count: 42,
        left_out: 0,
        from_notes: true,
        previous_draft_id: null,
      }),
    ).toBe(true);
    expect(isAiRunRef({})).toBe(true);
  });

  it.each([
    [
      'a string that is not a uuid',
      { notes: 'Brother Smith moved to adjourn' },
    ],
    ['a short word', { source: 'notes' }],
    ['text inside a list', { ids: [UUID, 'Smith'] }],
    ['a nested object', { meeting: { id: UUID } }],
    ['a key that is not snake_case', { meetingId: UUID }],
    ['a number that is not finite', { count: Number.NaN }],
    ['an array at the top', [UUID]],
    ['null', null],
    ['a string', UUID],
    ['a Date', new Date(0)],
    ['a Map', new Map([['meeting_id', UUID]])],
  ])('refuses %s', (_label, value) => {
    expect(isAiRunRef(value)).toBe(false);
  });

  it('refuses more than 32 keys and lists longer than 500', () => {
    const many = Object.fromEntries(
      Array.from({ length: 33 }, (_, i) => [`k${i}`, i]),
    );
    expect(isAiRunRef(many)).toBe(false);
    expect(isAiRunRef({ ids: Array.from({ length: 501 }, () => UUID) })).toBe(
      false,
    );
  });
});

describe('the run rules agree with the table', () => {
  it('statuses', () => {
    expect(checkList('status')).toEqual([...AI_RUN_STATUSES]);
  });

  it('failure reasons', () => {
    expect(checkList('failure_reason')).toEqual([...AI_RUN_FAILURE_REASONS]);
  });
});

describe('aiRunFailureMessage', () => {
  it('says every reason in plain words', () => {
    for (const reason of AI_RUN_FAILURE_REASONS) {
      const message = aiRunFailureMessage(reason, 3);
      expect(message).toMatch(/^[A-Z][^_]*\.$/);
    }
  });

  it('counts the tries', () => {
    expect(aiRunFailureMessage('attempts_exhausted', 3)).toBe(
      'It stopped after 3 tries that did not finish.',
    );
    expect(aiRunFailureMessage('attempts_exhausted', 1)).toBe(
      'It stopped because the try did not finish.',
    );
  });
});

describe('aiRunRetryDelayMs', () => {
  it('waits longer after each failed try', () => {
    expect([1, 2, 3, 4].map(aiRunRetryDelayMs)).toEqual([
      30_000, 120_000, 600_000, 600_000,
    ]);
  });
});
