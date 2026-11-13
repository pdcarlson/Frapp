import type { FeatureEventName } from '#domain/constants/feature-events';
import { decoratedHandlers } from '#test/helpers/feature-event-handlers';
import type {
  FeatureEventInput,
  FeatureEventMetadata,
} from '../decorators/feature-event.decorator';

/**
 * Each production `@FeatureEvent` describer (#593), run on the inputs it will
 * see: the raw request and the handler's result. `feature-event.interceptor.spec.ts`
 * covers how an event is sent; this covers what each one says, including
 * when it says nothing (a deduplicated retry, a vote that clears).
 *
 * Every handler whose event has a describer, or a `chapterId` option, needs a
 * case here; the last test fails otherwise.
 */

type Case = readonly [
  label: string,
  input: Partial<FeatureEventInput>,
  expected: Record<string, unknown> | null,
];

/** `Controller.method` → event → cases. */
const CASES: Record<string, Partial<Record<FeatureEventName, Case[]>>> = {
  'MeetingController.start': {
    'meeting-started': [
      [
        'from an event on the calendar',
        { body: { event_id: 'e1' }, result: { meeting_type: 'exec' } },
        { meeting_type: 'exec', from_new_event: false },
      ],
      [
        'for a meeting that was not on the calendar',
        {
          body: { new_event: { name: 'Retreat' } },
          result: { meeting_type: 'other' },
        },
        { meeting_type: 'other', from_new_event: true },
      ],
    ],
  },
  'MeetingController.post': {
    'meeting-posted': [
      [
        'minutes with a decision and no action items',
        {
          result: {
            meeting_type: 'chapter',
            content: {
              decisions: [{ text: 'd', vote: null }],
              action_items: [],
            },
          },
        },
        {
          meeting_type: 'chapter',
          has_decisions: true,
          has_action_items: false,
        },
      ],
    ],
  },
  'AttendanceController.checkIn': {
    'attendance-checked-in': [
      [
        'a bare body',
        { body: undefined },
        { method: 'plain', has_location: false },
      ],
      [
        'a scanned token with a location',
        { body: { token: 't', lat: 42.7, lng: -73.7 } },
        { method: 'qr', has_location: true },
      ],
      [
        'a typed code',
        { body: { manualCode: '4KQ-88', lat: 42.7 } },
        { method: 'manual_code', has_location: false },
      ],
      [
        'both, since either admits it',
        { body: { token: 't', manualCode: '4KQ-88' } },
        { method: 'qr_or_manual_code', has_location: false },
      ],
      [
        'a null token beside a code',
        { body: { token: null, manualCode: '4KQ-88' } },
        { method: 'manual_code', has_location: false },
      ],
      // Implicit conversion makes a number the string the DTO wants, and an
      // all-digit code verifies.
      [
        'an all-digit code sent as a number',
        { body: { manualCode: 448812 } },
        { method: 'manual_code', has_location: false },
      ],
      [
        'a token beside a numeric code',
        { body: { token: 't', manualCode: 448812 } },
        { method: 'qr_or_manual_code', has_location: false },
      ],
      [
        'a blank token beside a code',
        { body: { token: ' ', manualCode: '4KQ-88' } },
        { method: 'manual_code', has_location: false },
      ],
    ],
  },
  'AttendanceController.updateStatus': {
    'attendance-marked': [
      [
        'an excused absence',
        { body: { status: 'EXCUSED', excuse_reason: 'Sick' } },
        { status: 'EXCUSED', has_excuse: true },
      ],
      [
        'a blank excuse',
        { body: { status: 'ABSENT', excuse_reason: '  ' } },
        { status: 'ABSENT', has_excuse: false },
      ],
    ],
  },
  'EventExcuseController.decide': {
    'event-excuse-decided': [
      [
        'an approval',
        { body: { decision: 'APPROVED' } },
        { decision: 'APPROVED' },
      ],
    ],
  },
  'BackworkController.confirmUpload': {
    'backwork-uploaded': [
      [
        'a tagged, redacted exam',
        { body: { assignment_type: 'Exam', is_redacted: true, tags: ['a'] } },
        { assignment_type: 'Exam', is_redacted: true, tag_count: 1 },
      ],
      [
        'nothing optional',
        { body: {} },
        { assignment_type: null, is_redacted: false, tag_count: 0 },
      ],
    ],
  },
  'ChapterConfigController.patchConfig': {
    'chapter-config-updated': [
      [
        'one setting',
        { body: { enabled_modules: { rush: false } } },
        { section: 'enabled_modules' },
      ],
      [
        'a cleared default role',
        { body: { default_invite_role_id: null } },
        { section: 'default_invite_role_id' },
      ],
      [
        'several settings',
        { body: { dues: {}, points: {} } },
        { section: 'multiple' },
      ],
      ['an empty save', { body: {} }, null],
    ],
  },
  'ChapterDocumentController.confirmUploads': {
    'documents-imported': [
      [
        'a batch with one typed document and one filed in a folder',
        {
          body: {
            documents: [
              { document_type: 'Minutes', folder: ' ' },
              { folder: 'Finance' },
            ],
          },
        },
        { count: 2, typed_count: 1, filed_count: 1 },
      ],
      [
        'a body with no list, without throwing',
        { body: { documents: 'nope' } },
        { count: 0, typed_count: 0, filed_count: 0 },
      ],
    ],
  },
  'ChapterDocumentController.confirmUpload': {
    'document-uploaded': [
      [
        'a category and a blank folder',
        { body: { document_type: 'Minutes', folder: ' ' } },
        { has_document_type: true, has_folder: false },
      ],
      [
        'a number the pipe will convert, without throwing',
        { body: { document_type: 5 } },
        { has_document_type: true, has_folder: false },
      ],
    ],
  },
  'ChapterController.onboard': {
    'chapter-onboarded': [
      [
        'a directory chapter',
        {
          body: { directory_id: 'd1' },
          result: { id: 'c9', org_archetype: 'ifc' },
          signInMethod: 'google',
        },
        { archetype: 'ifc', from_directory: true, sign_in_method: 'google' },
      ],
      [
        'an unknown stored archetype',
        { body: {}, result: { id: 'c9', org_archetype: 'toString' } },
        { archetype: null, from_directory: false, sign_in_method: null },
      ],
    ],
  },
  'ChatReportController.fileReport': {
    'message-reported': [
      ['a report', { result: { reason: 'spam' } }, { reason: 'spam' }],
    ],
  },
  'ChatController.createChannel': {
    'channel-created': [
      [
        'a categorized channel',
        {
          result: { type: 'PUBLIC', is_read_only: true, category_id: 'cat' },
        },
        { type: 'PUBLIC', is_read_only: true, has_category: true },
      ],
    ],
  },
  'ChatController.sendMessage': {
    'message-sent': [
      [
        'a reply with attachments',
        {
          body: { attachments: [{}, {}] },
          result: {
            deduplicated: false,
            message: { kind: null, reply_to_id: 'm0' },
          },
        },
        { kind: 'text', is_reply: true, attachment_count: 2 },
      ],
      [
        'a deduplicated retry',
        {
          body: {},
          result: { deduplicated: true, message: { kind: 'text' } },
        },
        null,
      ],
    ],
    'poll-created': [
      [
        'a poll, counting only options a vote can name',
        {
          body: {
            payload: {
              options: [{ id: 'a' }, { id: 'b' }, {}],
              closes_at: '2026-11-05T00:00:00Z',
            },
          },
          result: { deduplicated: false, message: { kind: 'poll' } },
        },
        { choice_mode: 'single', option_count: 2, has_expiry: true },
      ],
      [
        "a poll posted with Doesn't close (#3896)",
        {
          body: {
            payload: { options: [{ id: 'a' }, { id: 'b' }], closes_at: null },
          },
          result: { deduplicated: false, message: { kind: 'poll' } },
        },
        { choice_mode: 'single', option_count: 2, has_expiry: false },
      ],
      [
        'a multi-choice poll with no close time',
        {
          body: { payload: { options: 'x', choice_mode: 'multi' } },
          result: { deduplicated: false, message: { kind: 'poll' } },
        },
        { choice_mode: 'multi', option_count: 0, has_expiry: false },
      ],
      [
        'a text message',
        {
          body: {},
          result: { deduplicated: false, message: { kind: 'text' } },
        },
        null,
      ],
      [
        'a retried poll',
        { body: {}, result: { deduplicated: true, message: { kind: 'poll' } } },
        null,
      ],
    ],
    'announcement-posted': [
      [
        'an announcement',
        { result: { deduplicated: false, message: { kind: 'announcement' } } },
        {},
      ],
      [
        'a text message',
        { result: { deduplicated: false, message: { kind: 'text' } } },
        null,
      ],
    ],
  },
  'ChatController.setMessageFlag': {
    'message-flagged': [
      [
        'an Important flag',
        { body: { flag: 'important' } },
        { flag: 'important' },
      ],
      ['a lighter flag', { body: { flag: 'funny' } }, { flag: 'funny' }],
    ],
  },
  'ChatController.recordMessageAction': {
    'message-reacted': [
      [
        'a reaction',
        {
          body: { action_type: 'reaction:👍' },
          result: { deduplicated: false },
        },
        {},
      ],
      [
        'a repeated reaction',
        {
          body: { action_type: 'reaction:👍' },
          result: { deduplicated: true },
        },
        null,
      ],
      [
        'a vote',
        { body: { action_type: 'vote' }, result: { deduplicated: false } },
        null,
      ],
    ],
    'poll-voted': [
      [
        'a first vote',
        {
          body: { action_type: 'vote', payload: { option_id: 'a' } },
          result: { deduplicated: false, updated: false },
        },
        { surface: 'card', selected_count: 1, is_revote: false },
      ],
      [
        'a changed multi-choice vote',
        {
          body: { action_type: 'vote', payload: { option_id: ['a', 'b', 3] } },
          result: { deduplicated: false, updated: true },
        },
        { surface: 'card', selected_count: 2, is_revote: true },
      ],
      [
        'clearing a vote',
        {
          body: { action_type: 'vote', payload: { option_id: [] } },
          result: { deduplicated: false, updated: true },
        },
        null,
      ],
      [
        'a deduplicated vote',
        {
          body: { action_type: 'vote', payload: { option_id: 'a' } },
          result: { deduplicated: true },
        },
        null,
      ],
      [
        'a reaction',
        { body: { action_type: 'reaction:👍' }, result: {} },
        null,
      ],
    ],
  },
  'DiscordImportController.create': {
    'discord-import-created': [
      ['an import', { result: { source: 'export' } }, { source: 'export' }],
    ],
  },
  'DiscordImportController.start': {
    'discord-import-started': [
      [
        'with a cutoff',
        { result: { messages_after: '2026-01-01T00:00:00Z' } },
        { has_cutoff: true },
      ],
      [
        'without one',
        { result: { messages_after: null } },
        { has_cutoff: false },
      ],
    ],
  },
  'EventController.create': {
    'event-created': [
      [
        'a recurring event with a card',
        {
          result: {
            is_mandatory: true,
            recurrence_rule: 'FREQ=WEEKLY',
            check_in_zone: null,
            point_value: 0,
            card_posted: true,
          },
        },
        {
          is_mandatory: true,
          is_recurring: true,
          has_check_in_zone: false,
          has_point_value: false,
          posted_to_chat: true,
        },
      ],
      [
        'a one-off with points and a zone',
        {
          result: {
            is_mandatory: false,
            recurrence_rule: null,
            check_in_zone: { type: 'circle' },
            point_value: 5,
          },
        },
        {
          is_mandatory: false,
          is_recurring: false,
          has_check_in_zone: true,
          has_point_value: true,
          posted_to_chat: false,
        },
      ],
    ],
  },
  'FinancialInvoiceController.transitionStatus': {
    'invoice-status-changed': [
      ['paid', { body: { status: 'PAID' } }, { status: 'PAID' }],
    ],
  },
  'InviteController.create': {
    'invite-created': [['a link', {}, { invite_method: 'link', count: 1 }]],
  },
  'InviteController.createBatch': {
    'invite-created': [
      [
        'a batch',
        { result: [{}, {}, {}] },
        { invite_method: 'batch', count: 3 },
      ],
    ],
  },
  'InviteController.createWithEmails': {
    'invite-created': [
      [
        'emails',
        { result: { invites: [{}, {}] } },
        { invite_method: 'email', count: 2 },
      ],
    ],
  },
  'InviteController.redeem': {
    'invite-redeemed': [
      [
        'a redeem after Sign in with Apple',
        { result: { chapterId: 'c7' }, signInMethod: 'apple' },
        { sign_in_method: 'apple' },
      ],
      [
        'a redeem with no session user',
        { result: { chapterId: 'c7' } },
        { sign_in_method: null },
      ],
    ],
  },
  'MemberController.updateOnboarding': {
    'member-onboarding-completed': [
      ['completed', { body: { has_completed_onboarding: true } }, {}],
      ['reset', { body: { has_completed_onboarding: false } }, null],
    ],
  },
  'PointsController.adjust': {
    'points-adjusted': [
      [
        'a fine',
        { result: { category: 'FINE', amount: -5, card_posted: false } },
        { category: 'FINE', direction: 'deduct', posted_to_chat: false },
      ],
      [
        'an award with a card',
        { result: { category: 'MANUAL', amount: 10, card_posted: true } },
        { category: 'MANUAL', direction: 'award', posted_to_chat: true },
      ],
    ],
  },
  'PollController.vote': {
    'poll-voted': [
      [
        'two options',
        { body: { option_indexes: [0, 2] } },
        { surface: 'page', selected_count: 2 },
      ],
      ['clearing a vote', { body: { option_indexes: [] } }, null],
    ],
  },
  'ReportController.attendance': {
    'report-generated': [
      [
        'a CSV',
        { query: { format: 'csv' } },
        { report_kind: 'attendance', format: 'csv' },
      ],
      ['the default', {}, { report_kind: 'attendance', format: 'json' }],
    ],
  },
  'ReportController.points': {
    'report-generated': [
      [
        'a PDF',
        { query: { format: 'pdf' } },
        { report_kind: 'points', format: 'pdf' },
      ],
    ],
  },
  'ReportController.roster': {
    'report-generated': [
      ['the default', {}, { report_kind: 'roster', format: 'json' }],
    ],
  },
  'ReportController.service': {
    'report-generated': [
      [
        'an unknown format read as the default',
        { query: { format: ['csv'] } },
        { report_kind: 'service', format: 'json' },
      ],
    ],
  },
  'RushController.create': {
    'rush-candidate-added': [
      [
        'an existing user with a card',
        { body: { user_id: 'u1' }, result: { card_posted: true } },
        { is_existing_user: true, posted_to_chat: true },
      ],
      [
        'a new name, no card due',
        { body: {}, result: {} },
        { is_existing_user: false, posted_to_chat: false },
      ],
    ],
  },
  'SemesterRolloverController.rollover': {
    'semester-rolled-over': [
      [
        'promoting new members',
        { body: { promote_new_members: true } },
        { promote_new_members: true },
      ],
      ['the default', { body: {} }, { promote_new_members: false }],
    ],
  },
  'ServiceEntryController.create': {
    'service-hours-logged': [
      [
        'hours without proof',
        {
          result: { duration_minutes: 90, proof_path: null, card_posted: true },
        },
        { duration_minutes: 90, has_proof: false, posted_to_chat: true },
      ],
    ],
  },
  'ServiceEntryController.review': {
    'service-hours-reviewed': [
      [
        'approved with a comment',
        {
          body: { review_comment: ' Thanks ' },
          result: { status: 'APPROVED' },
        },
        { status: 'APPROVED', has_comment: true },
      ],
      [
        'rejected with a blank comment',
        { body: { review_comment: '  ' }, result: { status: 'REJECTED' } },
        { status: 'REJECTED', has_comment: false },
      ],
    ],
  },
  'StudySessionController.stop': {
    'study-session-stopped': [
      [
        'a lapsed pause',
        { result: { status: 'PAUSED_EXPIRED', total_foreground_minutes: 42 } },
        { outcome: 'paused_expired', duration_minutes: 42 },
      ],
    ],
  },
  'TaskController.create': {
    'task-created': [
      [
        'a self-assigned task with a card',
        {
          result: {
            assignee_id: 'u1',
            created_by: 'u1',
            point_reward: null,
            proof_kind: 'none',
            photos: [],
            card_posted: true,
          },
        },
        {
          assigned_to_self: true,
          has_due_time: false,
          has_point_reward: false,
          has_reference_photo: false,
          has_subtasks: false,
          proof_kind: 'none',
          posted_to_chat: true,
        },
      ],
      [
        'an assigned task with points',
        {
          body: { subtasks: ['Mop the floor'] },
          result: {
            assignee_id: 'u2',
            created_by: 'u1',
            point_reward: 5,
            due_at: '2026-11-14T22:00:00.000Z',
            photos: [{ storage_path: 'chapters/c1/tasks/p1/mess.jpg' }],
            proof_kind: 'photo',
          },
        },
        {
          assigned_to_self: false,
          has_due_time: true,
          has_point_reward: true,
          has_reference_photo: true,
          has_subtasks: true,
          proof_kind: 'photo',
          posted_to_chat: false,
        },
      ],
    ],
  },
  'TaskController.updateStatus': {
    'task-status-changed': [
      [
        'in progress',
        { body: { status: 'IN_PROGRESS' } },
        {
          status: 'IN_PROGRESS',
          has_proof_photo: false,
          has_proof_link: false,
          has_completion_note: false,
        },
      ],
      [
        'done with proof',
        {
          body: {
            status: 'COMPLETED',
            proof_photo_paths: ['chapters/c1/tasks/p2/done.jpg'],
          },
        },
        {
          status: 'COMPLETED',
          has_proof_photo: true,
          has_proof_link: false,
          has_completion_note: false,
        },
      ],
      [
        'done again with a link and a reply',
        {
          body: {
            status: 'COMPLETED',
            proof_link: 'https://example.com',
            completion_note: 'Fixed',
          },
        },
        {
          status: 'COMPLETED',
          has_proof_photo: false,
          has_proof_link: true,
          has_completion_note: true,
        },
      ],
    ],
  },
  'TaskController.rejectCompletion': {
    'task-completion-rejected': [
      [
        'sent back',
        { body: { comment: 'Blurry' } },
        { asked_for_photo: false },
      ],
      [
        'sent back asking for a photo',
        { body: { comment: 'Blurry', require_photo: true } },
        { asked_for_photo: true },
      ],
    ],
  },
};

/** The chapter a route without `ChapterGuard` takes from its result. */
const CHAPTER_CASES: Record<string, [Partial<FeatureEventInput>, string]> = {
  'ChapterController.onboard/chapter-onboarded': [
    { body: {}, result: { id: 'c9', org_archetype: 'ifc' } },
    'c9',
  ],
  'InviteController.redeem/invite-redeemed': [
    { result: { chapterId: 'c7' } },
    'c7',
  ],
};

function fullInput(input: Partial<FeatureEventInput>): FeatureEventInput {
  return { body: {}, params: {}, query: {}, result: undefined, ...input };
}

describe('feature event describers (#593)', () => {
  let handlers: Map<string, readonly FeatureEventMetadata[]>;

  beforeAll(async () => {
    handlers = new Map(
      [...(await decoratedHandlers())].map(([key, h]) => [key, h.events]),
    );
  });

  function metadata(key: string, name: string): FeatureEventMetadata {
    const found = handlers.get(key)?.find((event) => event.name === name);
    if (!found) throw new Error(`${key} has no @FeatureEvent('${name}')`);
    return found;
  }

  const rows = Object.entries(CASES).flatMap(([key, events]) =>
    Object.entries(events).flatMap(([name, cases]) =>
      (cases ?? []).map(
        ([label, input, expected]) =>
          [key, name, label, input, expected] as const,
      ),
    ),
  );

  it.each(rows)('%s %s: %s', (key, name, _label, input, expected) => {
    const { describe: describer } = metadata(key, name);
    const described = describer ? describer(fullInput(input)) : {};
    expect(described).toEqual(expected);
  });

  it.each(Object.entries(CHAPTER_CASES))(
    '%s takes its chapter from the result',
    (keyAndName, [input, chapterId]) => {
      const [key, name] = keyAndName.split('/');
      expect(metadata(key, name).chapterId?.(fullInput(input))).toBe(chapterId);
    },
  );

  it('has a case for every describer and every chapter option', () => {
    const missing = [...handlers].flatMap(([key, events]) =>
      events.flatMap((event) => [
        ...(event.describe && !CASES[key]?.[event.name]?.length
          ? [`${key}/${event.name}: no describer case`]
          : []),
        ...(event.chapterId && !CHAPTER_CASES[`${key}/${event.name}`]
          ? [`${key}/${event.name}: no chapter case`]
          : []),
      ]),
    );
    expect(missing).toEqual([]);
  });
});
