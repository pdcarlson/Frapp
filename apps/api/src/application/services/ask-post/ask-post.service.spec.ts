import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ASK_POST_MAX_AGE_MS } from '@repo/validation';
import { SYSTEM_SENDER_ID } from '#domain/constants/chat';
import {
  sealAskReportReceipt,
  type AskReportReceipt,
} from '#domain/utils/ai-report-receipt';
import { parseAiTextKeyRing } from '#domain/utils/ai-text-cipher';
import type { ChapterMemberAccess } from '../rbac.service';
import { AskPostService } from './ask-post.service';

const CHAPTER = 'chapter-a';
const ASKER = 'user-asker';
const CHANNEL = '00000000-0000-4000-8000-0000000000c1';
const ASK_ID = '00000000-0000-4000-8000-000000000001';
const DOC = '00000000-0000-4000-8000-0000000000d1';
const MINUTES = '00000000-0000-4000-8000-0000000000a1';
const EVENT = '00000000-0000-4000-8000-0000000000e1';
const NOW = new Date('2026-11-13T18:00:00.000Z');
const KEY = `k1:${Buffer.alloc(32, 9).toString('base64')}`;
const ring = parseAiTextKeyRing(KEY);

type Given = AskReportReceipt['given'][number];

const bylaws: Given = {
  title: 'Bylaws, Article IV',
  text: 'Quorum is two thirds of active members.',
  ref: { type: 'document', id: DOC },
  label: 'Bylaws',
  kind: 'document',
};
const minutes: Given = {
  title: 'Executive board minutes',
  text: 'The board met.',
  ref: { type: 'meeting', id: MINUTES },
  label: 'Executive board minutes',
  kind: 'minutes',
};
const myTasks: Given = {
  title: 'Your tasks (live data, read just now)',
  text: 'You have 2 open tasks.',
  ref: { type: 'tool', name: 'my_tasks', reach: 'asker' },
  label: 'Your tasks',
  kind: 'tasks',
};
const calendar = (events?: string[]): Given => ({
  title: 'Events (live data, read just now)',
  text: 'Chapter meeting: Sunday.',
  ref: { type: 'tool', name: 'events', reach: 'events', events },
  label: 'Events',
  kind: 'events',
});

const receipt = (over: Partial<AskReportReceipt> = {}): AskReportReceipt => ({
  v: 1,
  ask_id: ASK_ID,
  issued_at: NOW.toISOString(),
  question: 'What is quorum?',
  written: 'Quorum is two thirds.',
  shown: {
    status: 'answered',
    reason: null,
    text: 'Quorum is two thirds.',
    citations: [{ source: 0, at: 21, quote: 'two thirds of active members' }],
    sources: [
      {
        kind: 'document',
        title: 'Bylaws',
        detail: 'Article IV',
        date: '2026-09-01T00:00:00.000Z',
        target: { type: 'document', document_id: DOC, page: 3 },
      },
    ],
    left_out_messages: 0,
    unverified_citations: 0,
    truncated: false,
  },
  given: [bylaws],
  tools: [],
  model: 'claude-test',
  prompt_version: 'ask-answer@v1',
  quoted_user_ids: [],
  ...over,
});

const sealed = (r: AskReportReceipt, userId = ASKER, chapterId = CHAPTER) =>
  sealAskReportReceipt(ring, r, { chapterId, userId })!;

const reader = (
  userId: string,
  permissions: string[] = ['members:view'],
  roleIds: string[] = [],
): ChapterMemberAccess =>
  ({
    user_id: userId,
    permissions: new Set(permissions),
    role_ids: roleIds,
  }) as ChapterMemberAccess;

function build(
  over: {
    readers?: ChapterMemberAccess[];
    readableMinutes?: string[];
    openEvents?: string[];
  } = {},
) {
  const channelAccess = {
    assertChannelAccess: jest.fn().mockResolvedValue({ id: CHANNEL }),
    channelReaders: jest
      .fn()
      .mockResolvedValue(over.readers ?? [reader(ASKER), reader('user-b')]),
  };
  const meetings = {
    readableByAll: jest
      .fn()
      .mockResolvedValue(new Set(over.readableMinutes ?? [])),
  };
  const events = {
    visibleToAll: jest.fn().mockResolvedValue(new Set(over.openEvents ?? [])),
  };
  const messageRepo = {
    insertIdempotent: jest.fn().mockResolvedValue('inserted'),
  };
  const consent = {
    check: jest.fn().mockResolvedValue({ allowed: true }),
  };
  const service = new AskPostService(
    consent as never,
    channelAccess as never,
    meetings as never,
    events as never,
    messageRepo as never,
  );
  const post = (
    r: AskReportReceipt | string,
    more: { confirm?: boolean; acknowledged?: string[]; userId?: string } = {},
  ) =>
    service.post({
      chapterId: CHAPTER,
      userId: more.userId ?? ASKER,
      channelId: CHANNEL,
      receipt: typeof r === 'string' ? r : sealed(r),
      confirm: more.confirm ?? true,
      acknowledged: more.acknowledged ?? [],
      now: NOW,
    });
  return {
    service,
    post,
    consent,
    channelAccess,
    meetings,
    events,
    messageRepo,
  };
}

const refusedWith = async (attempt: Promise<unknown>, code: string) => {
  const error = await attempt.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(BadRequestException);
  expect((error as BadRequestException).getResponse()).toMatchObject({ code });
};

describe('AskPostService', () => {
  const savedKey = process.env.AI_STORED_TEXT_KEY;
  beforeAll(() => {
    process.env.AI_STORED_TEXT_KEY = KEY;
  });
  afterAll(() => {
    if (savedKey === undefined) delete process.env.AI_STORED_TEXT_KEY;
    else process.env.AI_STORED_TEXT_KEY = savedKey;
  });

  describe('what it will not post', () => {
    it('refuses text the server did not seal', async () => {
      const { post, messageRepo, channelAccess } = build();
      await refusedWith(
        post('an answer I made up'),
        'ai.ask.post.receipt_invalid',
      );
      expect(channelAccess.assertChannelAccess).not.toHaveBeenCalled();
      expect(messageRepo.insertIdempotent).not.toHaveBeenCalled();
    });

    it("refuses another member's answer, and one from another chapter", async () => {
      const { post, messageRepo } = build();
      await refusedWith(
        post(sealed(receipt(), 'user-b')),
        'ai.ask.post.receipt_invalid',
      );
      await refusedWith(
        post(sealed(receipt(), ASKER, 'chapter-b')),
        'ai.ask.post.receipt_invalid',
      );
      expect(messageRepo.insertIdempotent).not.toHaveBeenCalled();
    });

    it('refuses when the server holds no key', async () => {
      const { post } = build();
      const envelope = sealed(receipt());
      delete process.env.AI_STORED_TEXT_KEY;
      try {
        await refusedWith(post(envelope), 'ai.ask.post.receipt_invalid');
      } finally {
        process.env.AI_STORED_TEXT_KEY = KEY;
      }
    });

    it('refuses an answer older than a day', async () => {
      const { post } = build();
      await refusedWith(
        post(
          receipt({
            issued_at: new Date(
              NOW.getTime() - ASK_POST_MAX_AGE_MS - 1000,
            ).toISOString(),
          }),
        ),
        'ai.ask.post.too_old',
      );
    });

    it('refuses a receipt from before sources said where they came from', async () => {
      const { post } = build();
      await refusedWith(
        post(receipt({ given: [{ title: 'Bylaws', text: 'Quorum.' }] })),
        'ai.ask.post.too_old',
      );
      const old = receipt();
      delete old.shown.sources[0].target;
      await refusedWith(post(old), 'ai.ask.post.too_old');
    });

    it.each(['not_found', 'refused', 'failed', 'unavailable'])(
      'refuses a turn that ended %s',
      async (status) => {
        const { post } = build();
        await refusedWith(
          post(receipt({ shown: { ...receipt().shown, status } })),
          'ai.ask.post.not_an_answer',
        );
      },
    );

    it('refuses an answer that was handed chat, cited or not', async () => {
      const { post, messageRepo } = build();
      await refusedWith(
        post(
          receipt({
            given: [
              bylaws,
              {
                title: 'Chat message in #general',
                text: 'see you at 7',
                ref: { type: 'chat' },
                label: '#general',
                kind: 'chat',
              },
            ],
          }),
          // Accepting a warning is not a way past it.
          { acknowledged: ['chat:1'] },
        ),
        'ai.ask.post.read_chat',
      );
      expect(messageRepo.insertIdempotent).not.toHaveBeenCalled();
    });

    it('refuses a follow-up: the earlier turns it read cannot be checked', async () => {
      const { post, channelAccess, messageRepo } = build();
      await refusedWith(
        post(receipt({ followed_up: true })),
        'ai.ask.post.follow_up',
      );
      expect(channelAccess.assertChannelAccess).not.toHaveBeenCalled();
      expect(messageRepo.insertIdempotent).not.toHaveBeenCalled();
    });

    it.each([
      ['chapter_off', 'ai.chapter_off'],
      ['member_declined', 'ai.consent.required'],
    ])(
      'refuses once Ask is off or the member said No (%s), as asking does',
      async (reason, code) => {
        const { post, consent, messageRepo } = build();
        consent.check.mockResolvedValue({ allowed: false, reason });
        const error = await post(receipt()).then(
          () => null,
          (caught: unknown) => caught,
        );
        expect(error).toBeInstanceOf(ForbiddenException);
        expect((error as ForbiddenException).getResponse()).toMatchObject({
          code,
        });
        expect(consent.check).toHaveBeenCalledWith(
          expect.objectContaining({
            chapterId: CHAPTER,
            actingUserId: ASKER,
            task: 'ask.answer',
          }),
        );
        expect(messageRepo.insertIdempotent).not.toHaveBeenCalled();
      },
    );

    it('refuses where the asker cannot post, before anything is checked or written', async () => {
      const { post, channelAccess, messageRepo } = build();
      channelAccess.assertChannelAccess.mockRejectedValue(
        new ForbiddenException(),
      );
      await expect(post(receipt())).rejects.toBeInstanceOf(ForbiddenException);
      expect(channelAccess.assertChannelAccess).toHaveBeenCalledWith(
        CHANNEL,
        CHAPTER,
        ASKER,
        'post',
      );
      expect(channelAccess.channelReaders).not.toHaveBeenCalled();
      expect(messageRepo.insertIdempotent).not.toHaveBeenCalled();
    });
  });

  describe('who else can open what it drew on', () => {
    it('asks first and writes nothing', async () => {
      const { post, messageRepo } = build();
      await expect(post(receipt(), { confirm: false })).resolves.toEqual({
        posted: false,
        restricted: [],
      });
      expect(messageRepo.insertIdempotent).not.toHaveBeenCalled();
    });

    it('a document is open when every other reader holds members:view', async () => {
      const everyone = build({
        readers: [reader(ASKER), reader('user-b'), reader('user-c', ['*'])],
      });
      await expect(
        everyone.post(receipt(), { confirm: false }),
      ).resolves.toEqual({ posted: false, restricted: [] });

      const oneCannot = build({
        readers: [reader(ASKER), reader('user-b'), reader('user-c', [])],
      });
      await expect(
        oneCannot.post(receipt(), { confirm: false }),
      ).resolves.toEqual({
        posted: false,
        restricted: [
          { key: `document:${DOC}`, kind: 'document', title: 'Bylaws' },
        ],
      });
    });

    it('lists a document once however many passages of it were read', async () => {
      const { post } = build({ readers: [reader(ASKER), reader('b', [])] });
      const { restricted } = await post(
        receipt({ given: [bylaws, { ...bylaws, text: 'Another passage.' }] }),
        { confirm: false },
      );
      expect(restricted).toHaveLength(1);
    });

    it('minutes are asked of the minutes rule, for the other readers only', async () => {
      const others = [reader('user-b'), reader('user-c')];
      const { post, meetings } = build({ readers: [reader(ASKER), ...others] });
      const { restricted } = await post(receipt({ given: [minutes] }), {
        confirm: false,
      });
      expect(meetings.readableByAll).toHaveBeenCalledWith(
        CHAPTER,
        [MINUTES],
        others,
      );
      expect(restricted).toEqual([
        {
          key: `meeting:${MINUTES}`,
          kind: 'minutes',
          title: 'Executive board minutes',
        },
      ]);

      const open = build({ readableMinutes: [MINUTES] });
      await expect(
        open.post(receipt({ given: [minutes] }), { confirm: false }),
      ).resolves.toEqual({ posted: false, restricted: [] });
    });

    it('minutes are not open to a reader without members:view, whatever the meeting says', async () => {
      // The minutes routes ask for the permission before the meeting's rule.
      const { post } = build({
        readers: [reader(ASKER), reader('user-b', [])],
        readableMinutes: [MINUTES],
      });
      const { restricted } = await post(receipt({ given: [minutes] }), {
        confirm: false,
      });
      expect(restricted.map(({ key }) => key)).toEqual([`meeting:${MINUTES}`]);
    });

    it('the roster and the calendar are not open to a reader without members:view', async () => {
      const roster: Given = {
        title: 'Members (live data, read just now)',
        text: 'The treasurer is Dana.',
        ref: { type: 'tool', name: 'roster', reach: 'chapter' },
        label: 'Members',
        kind: 'members',
      };
      const { post } = build({
        readers: [reader(ASKER), reader('user-b', [])],
        openEvents: [EVENT],
      });
      const { restricted } = await post(
        receipt({ given: [roster, calendar([EVENT])] }),
        { confirm: false },
      );
      expect(restricted.map(({ key }) => key)).toEqual([
        'tool:roster',
        'tool:events',
      ]);
    });

    it("the asker's own records always warn", async () => {
      const { post } = build();
      const { restricted } = await post(receipt({ given: [myTasks] }), {
        confirm: false,
      });
      expect(restricted).toEqual([
        { key: 'tool:my_tasks', kind: 'tasks', title: 'Your tasks' },
      ]);
    });

    it('the calendar is open unless it listed an event that leaves a reader out', async () => {
      const allOpen = build();
      await expect(
        allOpen.post(receipt({ given: [calendar()] }), { confirm: false }),
      ).resolves.toEqual({ posted: false, restricted: [] });

      const invited = build({ openEvents: [EVENT] });
      await expect(
        invited.post(receipt({ given: [calendar([EVENT])] }), {
          confirm: false,
        }),
      ).resolves.toEqual({ posted: false, restricted: [] });
      expect(invited.events.visibleToAll).toHaveBeenCalledWith(
        [EVENT],
        CHAPTER,
        [expect.objectContaining({ user_id: 'user-b' })],
      );

      const leftOut = build({ openEvents: [] });
      const { restricted } = await leftOut.post(
        receipt({ given: [calendar([EVENT])] }),
        { confirm: false },
      );
      expect(restricted).toEqual([
        { key: 'tool:events', kind: 'events', title: 'Events' },
      ]);
    });

    it('who is asking is what the roster shows of them: open to whoever may open the roster', async () => {
      const asker: Given = {
        title: 'Who is asking',
        text: 'Sam Abernathy. Roles: Member.',
        ref: { type: 'tool', name: 'asker', reach: 'chapter' },
        label: 'Your name and roles',
      };
      const open = build();
      await expect(
        open.post(receipt({ given: [asker, bylaws] }), { confirm: false }),
      ).resolves.toEqual({ posted: false, restricted: [] });
      const closed = build({ readers: [reader(ASKER), reader('user-b', [])] });
      const { restricted } = await closed.post(
        receipt({ given: [asker, bylaws] }),
        { confirm: false },
      );
      expect(restricted.map(({ key }) => key)).toEqual([
        'tool:asker',
        `document:${DOC}`,
      ]);
    });

    it('a source with no rule here is never called open', async () => {
      const { post } = build();
      const { restricted } = await post(
        receipt({
          given: [
            {
              title: 'Something new',
              text: 'x',
              ref: { type: 'other' },
              label: 'Something new',
              kind: 'document',
            },
          ],
        }),
        { confirm: false },
      );
      expect(restricted).toEqual([
        { key: 'other:0', kind: 'document', title: 'Something new' },
      ]);
    });

    it('warns about nothing when the asker is the only reader', async () => {
      const { post } = build({ readers: [reader(ASKER)] });
      await expect(
        post(receipt({ given: [myTasks, minutes] }), { confirm: false }),
      ).resolves.toEqual({ posted: false, restricted: [] });
    });
  });

  describe('posting', () => {
    it('posts one row from Frapp with the answer the server sealed', async () => {
      const { post, messageRepo } = build();
      await expect(post(receipt())).resolves.toEqual({
        posted: true,
        restricted: [],
      });
      expect(messageRepo.insertIdempotent).toHaveBeenCalledTimes(1);
      expect(messageRepo.insertIdempotent).toHaveBeenCalledWith({
        channel_id: CHANNEL,
        sender_id: SYSTEM_SENDER_ID,
        type: 'TEXT',
        kind: 'ask_answer',
        content: 'Quorum is two thirds.',
        client_message_id: `ask:${ASK_ID}`,
        payload: {
          v: 1,
          ask_id: ASK_ID,
          asked_by: ASKER,
          question: 'What is quorum?',
          // The marker and its source, without the quoted passage.
          citations: [{ source: 0, at: 21 }],
          sources: [
            {
              kind: 'document',
              title: 'Bylaws',
              detail: 'Article IV',
              date: '2026-09-01T00:00:00.000Z',
              target: { type: 'document', document_id: DOC, page: 3 },
            },
          ],
        },
      });
    });

    it('writes no mention and no thread: the row notifies nobody', async () => {
      const { post, messageRepo } = build();
      await post(receipt());
      const [row] = messageRepo.insertIdempotent.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(row).not.toHaveProperty('mentions');
      expect(row).not.toHaveProperty('thread_root_id');
      expect(row).not.toHaveProperty('reply_to_id');
    });

    it('does not post past a warning the asker has not accepted', async () => {
      const { post, messageRepo } = build();
      const mine = receipt({ given: [bylaws, myTasks] });
      await expect(post(mine)).resolves.toEqual({
        posted: false,
        restricted: [
          { key: 'tool:my_tasks', kind: 'tasks', title: 'Your tasks' },
        ],
      });
      // Accepting a different list is not accepting this one.
      await expect(
        post(mine, { acknowledged: [`document:${DOC}`] }),
      ).resolves.toMatchObject({ posted: false });
      expect(messageRepo.insertIdempotent).not.toHaveBeenCalled();

      await expect(
        post(mine, { acknowledged: ['tool:my_tasks'] }),
      ).resolves.toMatchObject({ posted: true });
      expect(messageRepo.insertIdempotent).toHaveBeenCalledTimes(1);
    });

    it("marks what was limited, and keeps the asker's own records from opening a reader's", async () => {
      const { post, messageRepo } = build({
        readers: [reader(ASKER), reader('user-b', [])],
      });
      const shown = receipt().shown;
      await post(
        receipt({
          given: [bylaws, myTasks],
          shown: {
            ...shown,
            sources: [
              ...shown.sources,
              {
                kind: 'tasks',
                title: 'Your tasks',
                detail: null,
                date: null,
                target: { type: 'page', page: 'tasks' },
              },
            ],
          },
        }),
        { acknowledged: [`document:${DOC}`, 'tool:my_tasks'] },
      );
      const [row] = messageRepo.insertIdempotent.mock.calls[0] as [
        { payload: { sources: unknown[] } },
      ];
      expect(row.payload.sources).toEqual([
        expect.objectContaining({ title: 'Bylaws', limited: true }),
        {
          kind: 'tasks',
          title: 'Your tasks',
          detail: null,
          date: null,
          target: null,
          own: true,
          limited: true,
        },
      ]);
    });

    it("lets the asker's own read win when two reads share a title", async () => {
      // Through the tool loop the calendar and one opened event (which
      // holds the asker's attendance) are both "Events".
      const { post, messageRepo } = build();
      const shown = receipt().shown;
      const own: Given = {
        title: 'Events, Formal (live data, read just now)',
        text: 'You are going.',
        ref: { type: 'tool', name: 'event:event-1', reach: 'asker' },
        label: 'Events',
        kind: 'events',
      };
      for (const given of [
        [own, calendar()],
        [calendar(), own],
      ]) {
        messageRepo.insertIdempotent.mockClear();
        await post(
          receipt({
            given,
            shown: {
              ...shown,
              sources: [
                {
                  kind: 'events',
                  title: 'Events',
                  detail: null,
                  date: null,
                  target: { type: 'page', page: 'events' },
                },
              ],
            },
          }),
          { acknowledged: ['tool:event:event-1'] },
        );
        const [row] = messageRepo.insertIdempotent.mock.calls[0] as [
          { payload: { sources: unknown[] } },
        ];
        expect(row.payload.sources).toEqual([
          expect.objectContaining({ own: true, target: null, limited: true }),
        ]);
      }
    });

    describe('reads that share a chip title (the tool loop reads one thing twice)', () => {
      const eventsChip = {
        kind: 'events',
        title: 'Events',
        detail: null,
        date: null,
        target: { type: 'page', page: 'events' },
      };
      const sourcesOf = (messageRepo: {
        insertIdempotent: jest.Mock;
      }): unknown[] =>
        (
          messageRepo.insertIdempotent.mock.calls[0] as [
            { payload: { sources: unknown[] } },
          ]
        )[0].payload.sources;

      it('marks the chip limited when either calendar read was', async () => {
        const second: Given = {
          ...calendar(),
          ref: { type: 'tool', name: 'events:formal', reach: 'events' },
        };
        const { post, messageRepo, events } = build();
        events.visibleToAll.mockResolvedValue(new Set());
        await post(
          receipt({
            given: [calendar(['event-1']), second],
            shown: { ...receipt().shown, sources: [eventsChip] },
          }),
          { acknowledged: ['tool:events'] },
        );
        expect(sourcesOf(messageRepo)).toEqual([
          { ...eventsChip, limited: true },
        ]);
      });

      it('does not link a read it has no rule for, and marks it limited', async () => {
        const officer: Given = {
          title: 'Chapter tasks (live data, read just now)',
          text: '3 tasks are late.',
          ref: { type: 'other' },
          label: 'Chapter tasks',
          kind: 'tasks',
        };
        const { post, messageRepo } = build();
        await post(
          receipt({
            given: [officer],
            shown: {
              ...receipt().shown,
              sources: [
                {
                  kind: 'tasks',
                  title: 'Chapter tasks',
                  detail: null,
                  date: null,
                  target: { type: 'page', page: 'tasks' },
                },
              ],
            },
          }),
          { acknowledged: ['other:0'] },
        );
        expect(sourcesOf(messageRepo)).toEqual([
          {
            kind: 'tasks',
            title: 'Chapter tasks',
            detail: null,
            date: null,
            target: null,
            limited: true,
          },
        ]);
      });

      it('keeps a document its own, whatever it is called', async () => {
        const own: Given = {
          title: 'Events, Formal (live data, read just now)',
          text: 'You are going.',
          ref: { type: 'tool', name: 'event:event-1', reach: 'asker' },
          label: 'Events',
          kind: 'events',
        };
        const { post, messageRepo } = build();
        const document = {
          kind: 'document',
          title: 'Events',
          detail: null,
          date: null,
          target: { type: 'document', document_id: DOC },
        };
        await post(
          receipt({
            given: [{ ...bylaws, label: 'Events' }, own],
            shown: { ...receipt().shown, sources: [document] },
          }),
          { acknowledged: ['tool:event:event-1'] },
        );
        expect(sourcesOf(messageRepo)).toEqual([document]);
      });
    });

    it('says when the answer was cut short', async () => {
      const { post, messageRepo } = build();
      await post(receipt({ shown: { ...receipt().shown, truncated: true } }));
      const [row] = messageRepo.insertIdempotent.mock.calls[0] as [
        { payload: Record<string, unknown> },
      ];
      expect(row.payload.truncated).toBe(true);
    });

    it('says so when the answer is already in the channel, live or deleted, and does not call it posted', async () => {
      const { post, messageRepo } = build();
      messageRepo.insertIdempotent.mockResolvedValueOnce('duplicate');
      await refusedWith(post(receipt()), 'ai.ask.post.already_posted');
    });
  });
});
