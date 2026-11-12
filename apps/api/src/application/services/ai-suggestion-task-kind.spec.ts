import { BadRequestException } from '@nestjs/common';
import {
  TASK_SUGGESTION_DESCRIPTION_MAX_LENGTH,
  TaskSuggestionKind,
  readTaskPayload,
} from './ai-suggestion-task-kind';

const MEMBER = '44444444-4444-4444-8444-444444444444';

describe('TaskSuggestionKind (#4309)', () => {
  const kind = new TaskSuggestionKind({} as never);

  it('normalizes a proposal: trims, caps, and keeps an owner only when it is a member id', () => {
    const payload = kind.normalizeProposal({
      title: '  Book the venue  ',
      description: 'x'.repeat(TASK_SUGGESTION_DESCRIPTION_MAX_LENGTH + 10),
      assignee_id: 'Jake',
      due_date: '2026-11-14',
      due_at: '2026-11-14T17:00:00.000Z',
      subtasks: ['Call', '', 'Pay deposit', 7],
      point_reward: 50,
    });
    expect(payload).toEqual({
      title: 'Book the venue',
      description: 'x'.repeat(TASK_SUGGESTION_DESCRIPTION_MAX_LENGTH),
      assignee_id: null,
      due_date: '2026-11-14',
      due_at: '2026-11-14T17:00:00.000Z',
      subtasks: ['Call', 'Pay deposit'],
    });
  });

  it('drops a time with no day, and a day that is not a real date', () => {
    expect(
      kind.normalizeProposal({ title: 'A', due_at: '2026-11-14T17:00:00Z' }),
    ).toMatchObject({ due_date: null, due_at: null });
    expect(
      kind.normalizeProposal({ title: 'A', due_date: '2026-02-30' }),
    ).toMatchObject({
      due_date: null,
    });
  });

  it('refuses a proposal with no title, or that is not an object', () => {
    expect(kind.normalizeProposal({ title: ' ' })).toBeNull();
    expect(kind.normalizeProposal(['title'])).toBeNull();
    expect(kind.normalizeProposal(null)).toBeNull();
  });

  it('applies only the edits sent, and a new day without a time clears the old time', () => {
    const base = kind.normalizeProposal({
      title: 'Book the venue',
      assignee_id: MEMBER,
      due_date: '2026-11-14',
      due_at: '2026-11-14T17:00:00.000Z',
    })!;
    const edited = readTaskPayload(
      kind.applyEdits(base, {
        title: undefined,
        due_date: '2026-11-15',
        description: null,
      }),
    );
    expect(edited).toMatchObject({
      title: 'Book the venue',
      assignee_id: MEMBER,
      due_date: '2026-11-15',
      due_at: null,
      description: null,
    });
    expect(() => kind.applyEdits(base, { title: '  ' })).toThrow(
      BadRequestException,
    );
  });

  it('asks for an owner and a day before it can be accepted', () => {
    expect(() =>
      kind.assertAcceptable(kind.normalizeProposal({ title: 'A' })!),
    ).toThrow('Pick who this task is for.');
    expect(() =>
      kind.assertAcceptable(
        kind.normalizeProposal({ title: 'A', assignee_id: MEMBER })!,
      ),
    ).toThrow('Pick a due date.');
  });
});
