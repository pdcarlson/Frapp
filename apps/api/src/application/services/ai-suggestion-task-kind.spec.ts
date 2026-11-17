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
      audience: null,
      due_date: '2026-11-14',
      due_at: '2026-11-14T17:00:00.000Z',
      subtasks: ['Call', 'Pay deposit'],
    });
  });

  it('keeps a task for everyone, and never a person beside it (#4295)', () => {
    expect(
      kind.normalizeProposal({
        title: 'Fill out the form',
        audience: 'everyone',
        assignee_id: MEMBER,
      }),
    ).toEqual(
      expect.objectContaining({ audience: 'everyone', assignee_id: null }),
    );
    expect(
      kind.normalizeProposal({ title: 'A', audience: 'the brothers' }),
    ).toEqual(expect.objectContaining({ audience: null }));
  });

  it('holds one answer to Who: a person clears everyone, and back (#4295)', () => {
    const forEveryone = kind.normalizeProposal({
      title: 'A',
      audience: 'everyone',
    })!;
    const forOne = kind.applyEdits(forEveryone, { assignee_id: MEMBER });
    expect(forOne).toEqual(
      expect.objectContaining({ assignee_id: MEMBER, audience: null }),
    );
    expect(kind.applyEdits(forOne, { audience: 'everyone' })).toEqual(
      expect.objectContaining({ assignee_id: null, audience: 'everyone' }),
    );
  });

  it('accepts one for everyone as the group task (#4295)', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'copy-1' });
    const groupKind = new TaskSuggestionKind({ create } as never);
    const payload = groupKind.normalizeProposal({
      title: 'Fill out the form',
      audience: 'everyone',
      due_date: '2026-11-20',
    })!;

    expect(() => groupKind.assertAcceptable(payload)).not.toThrow();
    await groupKind.commit({ chapterId: 'ch-1', userId: 'admin-1', payload });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: 'everyone',
        assignee_id: null,
        created_by: 'admin-1',
        point_reward: null,
      }),
    );
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
