import type { Meeting } from '#domain/entities/meeting.entity';
import { actionItemKey } from '#domain/utils/minutes-task-proposals';
import { MeetingTaskSuggestionsService } from './meeting-task-suggestions.service';

const CHAPTER = '11111111-1111-4111-8111-111111111111';
const OFFICER = '22222222-2222-4222-8222-222222222222';
const JAKE = '33333333-3333-4333-8333-333333333333';
const MEETING = '55555555-5555-4555-8555-555555555555';

const meeting = (over: Partial<Meeting> = {}): Meeting => ({
  id: MEETING,
  chapter_id: CHAPTER,
  event_id: null,
  event_name: 'Chapter meeting',
  event_start_time: '2026-11-09T00:00:00.000Z',
  meeting_type: 'chapter',
  other_label: null,
  status: 'posted',
  content: {
    action_items: [
      { text: 'Book the bus', owner_user_id: JAKE, due_date: '2026-11-14' },
      { text: 'Order shirts', owner_user_id: null, due_date: null },
    ],
  },
  created_by: OFFICER,
  updated_by: OFFICER,
  posted_by: OFFICER,
  posted_at: '2026-11-10T00:00:00.000Z',
  created_at: '2026-11-09T00:00:00.000Z',
  updated_at: '2026-11-10T00:00:00.000Z',
  ...over,
});

function build(switchOn = true) {
  const listeners: ((m: Meeting, c: never) => Promise<void>)[] = [];
  const meetings = {
    onPostedMinutesSaved: jest.fn((listener) => listeners.push(listener)),
  };
  const suggestions = {
    reconcileSource: jest.fn(async () => ({ created: [], withdrawn: 0 })),
  };
  const consent = { chapterSwitchOn: jest.fn(async () => switchOn) };
  const service = new MeetingTaskSuggestionsService(
    meetings as never,
    suggestions as never,
    consent as never,
  );
  return { service, meetings, suggestions, consent, listeners };
}

describe('MeetingTaskSuggestionsService (#4313)', () => {
  const env = process.env.AI_ENABLED;
  beforeEach(() => {
    process.env.AI_ENABLED = 'true';
  });
  afterAll(() => {
    if (env === undefined) delete process.env.AI_ENABLED;
    else process.env.AI_ENABLED = env;
  });

  it('proposes the action items of posted minutes and tells the officer who posted them', async () => {
    const { service, suggestions, consent } = build();
    await service.sync(meeting(), { reason: 'posted', actorId: OFFICER });

    expect(consent.chapterSwitchOn).toHaveBeenCalledWith(
      CHAPTER,
      'meeting_notes',
    );
    expect(suggestions.reconcileSource).toHaveBeenCalledWith({
      chapterId: CHAPTER,
      requestedFor: OFFICER,
      source: {
        type: 'meeting',
        id: MEETING,
        title: 'Chapter meeting',
        text: 'Book the bus\nOrder shirts',
      },
      kind: 'task',
      proposals: [
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
            assignee_id: null,
            due_date: null,
          },
          quote: 'Order shirts',
        },
      ],
      notify: [OFFICER],
    });
  });

  it('tells nobody about an edit after posting', async () => {
    const { service, suggestions } = build();
    await service.sync(meeting(), { reason: 'edited', actorId: OFFICER });
    expect(suggestions.reconcileSource).toHaveBeenCalledWith(
      expect.objectContaining({ notify: [] }),
    );
  });

  it('still runs for minutes with no action items, so removed items are taken back', async () => {
    const { service, suggestions } = build();
    await service.sync(meeting({ content: { action_items: [] } }), {
      reason: 'edited',
      actorId: OFFICER,
    });
    expect(suggestions.reconcileSource).toHaveBeenCalledWith(
      expect.objectContaining({ proposals: [] }),
    );
  });

  it('does nothing while the server has AI off, without reading the chapter', async () => {
    delete process.env.AI_ENABLED;
    const { service, suggestions, consent } = build();
    expect(
      await service.sync(meeting(), { reason: 'posted', actorId: OFFICER }),
    ).toBeNull();
    expect(consent.chapterSwitchOn).not.toHaveBeenCalled();
    expect(suggestions.reconcileSource).not.toHaveBeenCalled();
  });

  it('proposes nothing while the president has meeting notes off, and takes back what was waiting', async () => {
    const { service, suggestions } = build(false);
    await service.sync(meeting(), { reason: 'posted', actorId: OFFICER });
    expect(suggestions.reconcileSource).toHaveBeenCalledWith(
      expect.objectContaining({ proposals: [], notify: [] }),
    );
  });

  it('does nothing for a draft', async () => {
    const { service, suggestions } = build();
    await service.sync(meeting({ status: 'draft' }), {
      reason: 'edited',
      actorId: OFFICER,
    });
    expect(suggestions.reconcileSource).not.toHaveBeenCalled();
  });

  it('listens for posted minutes from the moment the module starts', async () => {
    const { service, meetings, suggestions, listeners } = build();
    service.onModuleInit();
    expect(meetings.onPostedMinutesSaved).toHaveBeenCalledTimes(1);
    await listeners[0](meeting(), {
      reason: 'posted',
      actorId: OFFICER,
    } as never);
    expect(suggestions.reconcileSource).toHaveBeenCalledTimes(1);
  });
});
