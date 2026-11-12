import { TaskSuggestionKind } from '../../application/services/ai-suggestion-task-kind';
import { TaskController } from './task.controller';

const MEMBER = '44444444-4444-4444-8444-444444444444';

/**
 * An accepted suggestion is a task made by the accepter, as the task form
 * would have made it (`spec/behavior/ai.md` § Acting on the chapter's
 * behalf). Kept beside the controller, since it compares the two doors.
 */
describe('a suggested task and the task form (#4313)', () => {
  it('makes exactly the task the task form would have made, as the accepter (#4313)', async () => {
    const CHAPTER = '11111111-1111-4111-8111-111111111111';
    const OFFICER = '22222222-2222-4222-8222-222222222222';
    const fields = {
      title: 'Book the bus',
      description: 'From the minutes of Chapter meeting.',
      assignee_id: MEMBER,
      due_date: '2026-11-14',
    };

    // The form: `POST /v1/tasks`, through the controller.
    const fromForm = jest.fn(async (input: object) => ({
      id: 'task-1',
      ...input,
    }));
    await new TaskController({ create: fromForm } as never, {} as never).create(
      CHAPTER,
      OFFICER,
      fields,
    );

    // The suggestion: accepted as proposed.
    const fromSuggestion = jest.fn(async (input: object) => ({
      id: 'task-2',
      ...input,
    }));
    const accepting = new TaskSuggestionKind({
      create: fromSuggestion,
    } as never);
    await accepting.commit({
      chapterId: CHAPTER,
      userId: OFFICER,
      payload: accepting.normalizeProposal(fields)!,
    });

    // Compared as the task service reads them: a field left out is a field
    // unset (no steps, no chat card).
    const asRead = (mock: jest.Mock) => ({
      subtasks: [],
      ...JSON.parse(JSON.stringify(mock.mock.calls[0][0])),
    });
    expect(asRead(fromSuggestion)).toEqual(asRead(fromForm));
    expect(asRead(fromSuggestion)).toMatchObject({
      created_by: OFFICER,
      point_reward: null,
    });
  });
});
