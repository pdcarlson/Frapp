import { TaskStatus, type Task } from '#domain/entities/task.entity';
import {
  NudgeOutputSchema,
  buildNudgeFacts,
  checkNudgeWords,
  nudgeMessages,
} from '#domain/utils/member-nudge';
import type { MemberNudgeKind } from '@repo/validation';
import type { LanguageModelRequest } from '#domain/adapters/language-model.interface';
import { scriptedMemberNudge } from './scripted-member-nudge';

const NOW = new Date('2026-11-13T15:00:00.000Z');

const TASK: Task = {
  id: 'task-1',
  chapter_id: 'chapter-1',
  title: 'Book the formal venue',
  description: null,
  assignee_id: 'user-1',
  created_by: 'officer-1',
  due_date: '2026-11-16',
  due_at: null,
  status: TaskStatus.TODO,
  point_reward: 10,
  points_awarded: false,
  completed_at: null,
  confirmed_at: null,
  sent_back_at: null,
  proof_kind: 'none',
  proof_link: null,
  sent_back_reason: null,
  completion_note: null,
  created_at: '2026-11-08T15:00:00.000Z',
};

/** The scripted card must be one the real checks would let through. */
describe('scriptedMemberNudge', () => {
  it.each<[MemberNudgeKind, Partial<Task>]>([
    ['task_due_soon', {}],
    ['task_overdue', { due_date: '2026-11-08' }],
    [
      'task_sent_back',
      {
        sent_back_at: '2026-11-10T15:00:00.000Z',
        sent_back_reason: 'Add the quote from venue 2',
      },
    ],
    [
      'task_praise',
      {
        status: TaskStatus.COMPLETED,
        completed_at: '2026-11-12T15:00:00.000Z',
      },
    ],
  ])('writes a %s card that passes the checks', (kind, change) => {
    const facts = buildNudgeFacts({
      candidate: { kind, task: { ...TASK, ...change } },
      firstName: 'Sam',
      subtasks: [],
      history: {
        similarDone: 3,
        similarTypicalDays: 4,
        similarTypicalAllowedDays: 7,
        ownDone: 2,
        ownOnTime: 2,
      },
      timeZone: 'America/New_York',
      now: NOW,
    });
    const reply = scriptedMemberNudge({
      messages: nudgeMessages(facts),
    } as LanguageModelRequest);
    const output = NudgeOutputSchema.parse(
      'object' in reply ? reply.object : null,
    );
    const words = checkNudgeWords(output, facts);
    expect(words).not.toBeNull();
    expect(words?.body).toContain('Book the formal venue');
  });
});
