import { BadRequestException } from '@nestjs/common';
import {
  TASK_SUGGESTION_DESCRIPTION_MAX_LENGTH,
  TaskSuggestionKind,
  readTaskPayload,
} from './ai-suggestion-task-kind';

const MEMBER = '44444444-4444-4444-8444-444444444444';

describe('TaskSuggestionKind (#4309)', () => {
  const kind = new TaskSuggestionKind({} as never, {} as never);

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
      assignee_ids: null,
      audience: null,
      audience_role_id: null,
      audience_group_id: null,
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
    const groupKind = new TaskSuggestionKind({ create } as never, {} as never);
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

  describe('several people, a role or group, and someone (2026-11-18)', () => {
    const OTHER = '55555555-5555-4555-8555-555555555555';
    const ROLE = '66666666-6666-4666-8666-666666666666';
    const GROUP = '77777777-7777-4777-8777-777777777777';

    it('reads each form, and a list of one as that person', () => {
      expect(
        kind.normalizeProposal({
          title: 'A',
          assignee_ids: [MEMBER, OTHER, MEMBER],
        }),
      ).toMatchObject({ assignee_id: null, assignee_ids: [MEMBER, OTHER] });
      expect(
        kind.normalizeProposal({ title: 'A', assignee_ids: [MEMBER, 'Jake'] }),
      ).toMatchObject({ assignee_id: MEMBER, assignee_ids: null });
      expect(
        kind.normalizeProposal({
          title: 'A',
          audience: 'everyone',
          audience_role_id: ROLE,
          audience_group_id: GROUP,
        }),
      ).toMatchObject({
        audience: 'everyone',
        audience_role_id: ROLE,
        // A role wins over a group: one answer.
        audience_group_id: null,
      });
      expect(
        kind.normalizeProposal({
          title: 'A',
          audience: 'someone',
          assignee_ids: [MEMBER, OTHER],
        }),
      ).toMatchObject({ audience: 'someone', assignee_ids: [MEMBER, OTHER] });
      expect(
        kind.normalizeProposal({
          title: 'A',
          audience: 'someone',
          assignee_ids: [MEMBER],
        }),
      ).toMatchObject({ audience: null, assignee_id: MEMBER });
    });

    it('keeps a payload written before these fields readable', () => {
      expect(
        readTaskPayload({ title: 'A', assignee_id: MEMBER, audience: null }),
      ).toMatchObject({
        assignee_id: MEMBER,
        assignee_ids: null,
        audience: null,
        audience_role_id: null,
        audience_group_id: null,
      });
    });

    it('replaces the whole answer to Who on an edit', () => {
      const forRole = kind.normalizeProposal({
        title: 'A',
        audience: 'someone',
        audience_role_id: ROLE,
      })!;
      expect(
        kind.applyEdits(forRole, { assignee_ids: [MEMBER, OTHER] }),
      ).toMatchObject({
        audience: null,
        audience_role_id: null,
        assignee_ids: [MEMBER, OTHER],
      });
      expect(kind.applyEdits(forRole, { title: 'B' })).toMatchObject({
        audience: 'someone',
        audience_role_id: ROLE,
      });
    });

    const accepted = async (
      proposal: Record<string, unknown>,
      source?: { type: string; id: string },
    ) => {
      const create = jest.fn().mockResolvedValue({ id: 'task-1' });
      const post = jest.fn().mockResolvedValue({ id: 'posting-1' });
      const accepting = new TaskSuggestionKind(
        { create } as never,
        { create: post } as never,
      );
      const payload = accepting.normalizeProposal({
        title: 'Table at the fair',
        due_date: '2026-11-20',
        ...proposal,
      })!;
      accepting.assertAcceptable(payload);
      const { resultId } = await accepting.commit({
        chapterId: 'ch-1',
        userId: 'admin-1',
        payload,
        source,
      });
      return { create, post, resultId };
    };

    it('accepts several people as a copy each', async () => {
      const { create, post } = await accepted({
        assignee_ids: [MEMBER, OTHER],
      });
      expect(post).not.toHaveBeenCalled();
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          assignee_id: null,
          assignee_ids: [MEMBER, OTHER],
          audience: null,
        }),
      );
    });

    it('accepts everyone in a role as a copy for each holder', async () => {
      const { create } = await accepted({
        audience: 'everyone',
        audience_role_id: ROLE,
      });
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          audience: 'everyone',
          audience_role_id: ROLE,
          audience_group_id: null,
          assignee_id: null,
        }),
      );
    });

    it.each([
      [{}, { kind: 'chapter' }],
      [{ audience_role_id: ROLE }, { kind: 'role', id: ROLE }],
      [{ audience_group_id: GROUP }, { kind: 'group', id: GROUP }],
      [
        { assignee_ids: [MEMBER, OTHER] },
        { kind: 'people', userIds: [MEMBER, OTHER] },
      ],
    ])(
      'accepts "someone" as one task up for grabs (%j)',
      async (scope, target) => {
        const { create, post, resultId } = await accepted({
          audience: 'someone',
          ...scope,
        });
        expect(create).not.toHaveBeenCalled();
        expect(post).toHaveBeenCalledWith(
          expect.objectContaining({
            chapter_id: 'ch-1',
            created_by: 'admin-1',
            title: 'Table at the fair',
            due_date: '2026-11-20',
            point_reward: null,
            target,
          }),
        );
        expect(resultId).toBe('posting-1');
      },
    );

    it('links a task from minutes to them by id, a posting too (#5562)', async () => {
      const minutes = { type: 'meeting', id: 'meeting-1' };
      const person = await accepted({ assignee_id: MEMBER }, minutes);
      expect(person.create).toHaveBeenCalledWith(
        expect.objectContaining({ meeting_id: 'meeting-1' }),
      );
      const someone = await accepted({ audience: 'someone' }, minutes);
      expect(someone.post).toHaveBeenCalledWith(
        expect.objectContaining({ meeting_id: 'meeting-1' }),
      );
      const other = await accepted(
        { assignee_id: MEMBER },
        { type: 'event', id: 'event-1' },
      );
      expect(other.create).toHaveBeenCalledWith(
        expect.not.objectContaining({ meeting_id: expect.anything() }),
      );
    });
  });
});
