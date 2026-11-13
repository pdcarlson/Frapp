import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { IMeetingNotesRepository } from '#domain/repositories/meeting-notes.repository.interface';
import type { IMeetingDraftRepository } from '#domain/repositories/meeting-draft.repository.interface';
import type { IMeetingRecordingRepository } from '#domain/repositories/meeting-recording.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import type { Meeting, MeetingNote } from '#domain/entities/meeting.entity';
import { OUTSIDE_TIERS_RANK } from '#domain/utils/role-rank';
import { MeetingNotesService } from './meeting-notes.service';
import type { MeetingService } from './meeting.service';
import type { RbacService } from './rbac.service';
import type { NotificationService } from './notification.service';
import type { AiConsentService } from './ai/ai-consent.service';

const CHAPTER = 'ch-1';
const MEETING = 'mtg-1';
const AUTHOR = 'u-author';
const OFFICER = 'u-officer';
const PLEDGE_ED = 'u-pledge-ed';
const OUTSIDER = 'u-outsider';

const meeting = (overrides: Partial<Meeting> = {}): Meeting => ({
  id: MEETING,
  chapter_id: CHAPTER,
  event_id: 'evt-1',
  event_name: 'Chapter meeting',
  event_start_time: '2026-11-08T19:00:00.000Z',
  meeting_type: 'chapter',
  other_label: null,
  status: 'draft',
  content: {},
  created_by: AUTHOR,
  updated_by: AUTHOR,
  posted_by: null,
  posted_at: null,
  created_at: '2026-11-08T20:00:00.000Z',
  updated_at: '2026-11-08T20:00:00.000Z',
  ...overrides,
});

/** `meeting_notes`, in memory. */
class FakeNotes implements IMeetingNotesRepository {
  rows: MeetingNote[] = [];
  findByMeeting() {
    return Promise.resolve(this.rows.map((r) => ({ ...r })));
  }
  find(_c: string, _m: string, userId: string) {
    const row = this.rows.find((r) => r.user_id === userId);
    return Promise.resolve(row ? { ...row } : null);
  }
  findByUser(_c: string, userId: string) {
    return Promise.resolve(this.rows.filter((r) => r.user_id === userId));
  }
  upsert(row: Omit<MeetingNote, 'created_at' | 'updated_at'>) {
    const at = this.rows.findIndex((r) => r.user_id === row.user_id);
    const saved: MeetingNote = {
      ...row,
      added_by: at >= 0 ? this.rows[at].added_by : row.added_by,
      created_at: '2026-11-08T20:00:00.000Z',
      updated_at: '2026-11-08T21:00:00.000Z',
    };
    if (at >= 0) this.rows[at] = saved;
    else this.rows.push(saved);
    return Promise.resolve(saved);
  }
  add(row: {
    meeting_id: string;
    chapter_id: string;
    user_id: string;
    added_by: string;
  }) {
    if (!this.rows.some((r) => r.user_id === row.user_id)) {
      this.rows.push({
        ...row,
        notes: '',
        created_at: '2026-11-08T20:00:00.000Z',
        updated_at: '2026-11-08T20:00:00.000Z',
      });
    }
    return Promise.resolve();
  }
  delete(_c: string, _m: string, userId: string) {
    this.rows = this.rows.filter((r) => r.user_id !== userId);
    return Promise.resolve();
  }
  deleteCreatedBefore = jest.fn().mockResolvedValue(4);
}

interface Person {
  permissions: string[];
  /** Tier position; outside the tiers when absent. */
  rank?: number;
  invited?: boolean;
  consented?: boolean;
}

const PEOPLE: Record<string, Person> = {
  [AUTHOR]: { permissions: ['meetings:record'], rank: 1 },
  [OFFICER]: { permissions: ['meetings:record'], rank: 1 },
  [PLEDGE_ED]: { permissions: [], rank: 3 },
  [OUTSIDER]: { permissions: ['meetings:record'], rank: 1, invited: false },
};

function setup(stored: Meeting = meeting(), people = PEOPLE) {
  const notes = new FakeNotes();
  const drafts = { deleteWrittenFrom: jest.fn().mockResolvedValue(undefined) };
  const recordings = { find: jest.fn().mockResolvedValue(null) };
  const person = (id: string): Person =>
    people[id] ?? { permissions: [], invited: false };
  const meetings = {
    noteTakingView: jest.fn((_c: string, _m: string, userId: string) => {
      const p = person(userId);
      const has = (x: string) =>
        p.permissions.includes('*') || p.permissions.includes(x);
      const visible = p.invited !== false;
      return Promise.resolve({
        meeting: stored,
        canEdit:
          has('meetings:edit') || (stored.created_by === userId && visible),
        eventVisible: visible,
        canRecord: has('meetings:record'),
      });
    }),
    eventShowsTo: jest.fn((_c: string, _m: Meeting, userId: string) =>
      Promise.resolve(person(userId).invited !== false),
    ),
    draftsVisibleTo: jest.fn().mockResolvedValue([stored]),
  };
  const rbac = {
    getEffectivePermissions: jest.fn((_c: string, userId: string) =>
      Promise.resolve(person(userId).permissions),
    ),
    getRankContext: jest.fn((_c: string, userId: string) => {
      const p = person(userId);
      return Promise.resolve({
        reach: {
          memberId: `m-${userId}`,
          rank: p.rank ?? OUTSIDE_TIERS_RANK,
          permissions: new Set(p.permissions),
          wildcard: p.permissions.includes('*'),
        },
        roles: [],
        tiers: [
          { id: 't1', name: 'Exec board', position: 1 },
          { id: 't3', name: 'Members', position: 3 },
        ],
        positions: new Map([
          ['t1', 1],
          ['t3', 3],
        ]),
      });
    }),
  };
  const members = {
    findByUserAndChapter: jest.fn((userId: string) =>
      Promise.resolve(
        people[userId]
          ? { id: `m-${userId}`, chapter_id: CHAPTER, user_id: userId }
          : null,
      ),
    ),
    findChapterMemberIdentities: jest.fn().mockResolvedValue([
      { user_id: AUTHOR, display_name: 'Eli Sorensen', role_ids: [] },
      { user_id: OFFICER, display_name: 'Sam Abernathy', role_ids: [] },
      { user_id: PLEDGE_ED, display_name: 'Theo Vasquez', role_ids: [] },
    ]),
  };
  const notifications = {
    notifyMembers: jest.fn().mockResolvedValue(undefined),
  };
  const consent = {
    check: jest.fn(({ actingUserId }: { actingUserId: string }) =>
      Promise.resolve(
        person(actingUserId).consented === false
          ? { allowed: false, reason: 'consent_required' }
          : { allowed: true },
      ),
    ),
  };
  const service = new MeetingNotesService(
    notes,
    drafts as unknown as IMeetingDraftRepository,
    recordings as unknown as IMeetingRecordingRepository,
    members as unknown as IMemberRepository,
    meetings as unknown as MeetingService,
    rbac as unknown as RbacService,
    notifications as unknown as NotificationService,
    consent as unknown as AiConsentService,
  );
  return { service, notes, drafts, recordings, notifications, meetings };
}

describe('MeetingNotesService', () => {
  describe('who takes notes', () => {
    it('lets an officer with meetings:record join by writing', async () => {
      const { service, notes } = setup();
      const state = await service.save(CHAPTER, MEETING, OFFICER, 'vote 21-6');
      expect(state.role).toBe('note_taker');
      expect(state.mine.notes).toBe('vote 21-6');
      expect(notes.rows).toEqual([
        expect.objectContaining({ user_id: OFFICER, added_by: null }),
      ]);
    });

    it('turns away a member with no meetings permission nobody added', async () => {
      const { service } = setup();
      await expect(
        service.save(CHAPTER, MEETING, PLEDGE_ED, 'hi'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('turns away an officer the event leaves out, as if there were no minutes', async () => {
      const { service } = setup();
      await expect(
        service.state(CHAPTER, MEETING, OUTSIDER),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('takes no notes on posted or Standards minutes', async () => {
      await expect(
        setup(meeting({ status: 'posted' })).service.state(
          CHAPTER,
          MEETING,
          AUTHOR,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        setup(meeting({ meeting_type: 'standards' as never })).service.save(
          CHAPTER,
          MEETING,
          AUTHOR,
          'hearing notes',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('adding a note-taker', () => {
    it('lets the author add an audience member, who is told once', async () => {
      const { service, notifications } = setup();
      await service.add(CHAPTER, MEETING, AUTHOR, PLEDGE_ED);
      await service.add(CHAPTER, MEETING, AUTHOR, PLEDGE_ED);
      expect(notifications.notifyMembers).toHaveBeenCalledTimes(1);
      expect(notifications.notifyMembers).toHaveBeenCalledWith(
        CHAPTER,
        [PLEDGE_ED],
        expect.objectContaining({
          title: 'Take notes',
          data: { target: { screen: 'events', eventId: 'evt-1' } },
        }),
      );
      const theirs = await service.save(
        CHAPTER,
        MEETING,
        PLEDGE_ED,
        'bids due Fri',
      );
      expect(theirs.role).toBe('note_taker');
    });

    it('refuses a member the meeting’s event doesn’t invite', async () => {
      const people = {
        ...PEOPLE,
        [PLEDGE_ED]: { ...PEOPLE[PLEDGE_ED], invited: false },
      };
      const { service } = setup(meeting(), people);
      await expect(
        service.add(CHAPTER, MEETING, AUTHOR, PLEDGE_ED),
      ).rejects.toMatchObject({
        response: { code: 'meeting.not_in_audience' },
      });
    });

    it('lets only the author or an editor add', async () => {
      const { service } = setup();
      await expect(
        service.add(CHAPTER, MEETING, OFFICER, PLEDGE_ED),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('who sees whose notes', () => {
    it('shows the author everyone’s notes and a note-taker only their own', async () => {
      const { service } = setup();
      await service.save(CHAPTER, MEETING, AUTHOR, 'my notes');
      await service.save(CHAPTER, MEETING, OFFICER, 'their notes');
      const author = await service.state(CHAPTER, MEETING, AUTHOR);
      expect(author.takers).toEqual([
        expect.objectContaining({
          display_name: 'Sam Abernathy',
          notes: 'their notes',
        }),
      ]);
      const officer = await service.state(CHAPTER, MEETING, OFFICER);
      expect(officer.takers).toEqual([]);
      expect(officer.others_count).toBe(1);
      expect(officer.mine.notes).toBe('their notes');
      expect(JSON.stringify(officer)).not.toContain('my notes');
    });
  });

  describe('clearing and removing', () => {
    it('clearing notes removes them and any draft written from them', async () => {
      const { service, notes, drafts } = setup();
      await service.save(CHAPTER, MEETING, OFFICER, 'notes');
      await service.clear(CHAPTER, MEETING, OFFICER);
      expect(notes.rows).toEqual([]);
      expect(drafts.deleteWrittenFrom).toHaveBeenCalledWith(
        CHAPTER,
        MEETING,
        OFFICER,
      );
    });

    it('a member someone added stays on with empty notes after clearing', async () => {
      const { service, notes } = setup();
      await service.add(CHAPTER, MEETING, AUTHOR, PLEDGE_ED);
      await service.save(CHAPTER, MEETING, PLEDGE_ED, 'notes');
      await service.save(CHAPTER, MEETING, PLEDGE_ED, '   ');
      expect(notes.rows).toEqual([
        expect.objectContaining({
          user_id: PLEDGE_ED,
          notes: '',
          added_by: AUTHOR,
        }),
      ]);
    });

    it('removes a note-taker with their notes; a note-taker may leave', async () => {
      const { service, notes, drafts } = setup();
      await service.save(CHAPTER, MEETING, OFFICER, 'notes');
      await service.remove(CHAPTER, MEETING, OFFICER, OFFICER);
      expect(notes.rows).toEqual([]);
      expect(drafts.deleteWrittenFrom).toHaveBeenCalledWith(
        CHAPTER,
        MEETING,
        OFFICER,
      );
      await service.add(CHAPTER, MEETING, AUTHOR, PLEDGE_ED);
      await expect(
        service.remove(CHAPTER, MEETING, PLEDGE_ED, AUTHOR),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('what a draft reads', () => {
    it('ranks the author first, then by tier, and the recording as its own source', async () => {
      const { service, recordings } = setup();
      await service.add(CHAPTER, MEETING, AUTHOR, PLEDGE_ED);
      await service.save(CHAPTER, MEETING, PLEDGE_ED, 'pledge notes');
      await service.save(CHAPTER, MEETING, OFFICER, 'officer notes');
      await service.save(CHAPTER, MEETING, AUTHOR, 'author notes');
      recordings.find.mockResolvedValue({
        status: 'ready',
        transcript: 'Speaker 1: hello',
      });
      const { sources, sourceUserIds } = await service.sourcesFor(
        CHAPTER,
        meeting(),
      );
      expect(sources.map((s) => [s.id, s.label, s.standing, s.rank])).toEqual([
        ['S1', 'Eli Sorensen', 'minutes author', -2],
        ['S2', 'Sam Abernathy', 'Exec board', 1],
        ['S3', 'Theo Vasquez', 'Members', 3],
        ['S4', 'Recording', null, 1_000_000],
      ]);
      expect(sourceUserIds).toEqual([AUTHOR, OFFICER, PLEDGE_ED]);
    });

    it('leaves out notes whose writer hasn’t turned Frapp AI on, or can no longer take notes', async () => {
      const people = {
        ...PEOPLE,
        [OFFICER]: { ...PEOPLE[OFFICER], consented: false },
      };
      const { service, notes } = setup(meeting(), people);
      await service.save(CHAPTER, MEETING, AUTHOR, 'author notes');
      notes.rows.push({
        meeting_id: MEETING,
        chapter_id: CHAPTER,
        user_id: OFFICER,
        notes: 'officer notes',
        added_by: null,
        created_at: '',
        updated_at: '',
      });
      notes.rows.push({
        meeting_id: MEETING,
        chapter_id: CHAPTER,
        user_id: OUTSIDER,
        notes: 'outsider notes',
        added_by: null,
        created_at: '',
        updated_at: '',
      });
      const { sources } = await service.sourcesFor(CHAPTER, meeting());
      expect(sources.map((s) => s.label)).toEqual(['Eli Sorensen']);
      const state = await service.state(CHAPTER, MEETING, AUTHOR);
      expect(state.takers.find((t) => t.user_id === OFFICER)?.held).toBe(
        'consent_required',
      );
    });

    it('reads a transcript a phone pasted into its notes only once', async () => {
      const { service, recordings } = setup();
      await service.save(CHAPTER, MEETING, AUTHOR, 'Speaker 1: hello');
      recordings.find.mockResolvedValue({
        status: 'ready',
        transcript: 'Speaker 1: hello',
      });
      const { sources } = await service.sourcesFor(CHAPTER, meeting());
      expect(sources).toHaveLength(1);
    });

    it('has nothing to draft from with no notes and no transcript', async () => {
      const { service } = setup();
      await expect(
        service.sourcesFor(CHAPTER, meeting()),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('the note-taking list', () => {
    it('lists others’ drafts to an officer, and to a member only once added', async () => {
      const { service } = setup();
      expect(await service.listForUser(CHAPTER, OFFICER)).toEqual([
        expect.objectContaining({
          meeting_id: MEETING,
          author_name: 'Eli Sorensen',
          joined: false,
        }),
      ]);
      expect(await service.listForUser(CHAPTER, PLEDGE_ED)).toEqual([]);
      await service.add(CHAPTER, MEETING, AUTHOR, PLEDGE_ED);
      expect(await service.listForUser(CHAPTER, PLEDGE_ED)).toEqual([
        expect.objectContaining({ joined: true, added: true }),
      ]);
      expect(await service.listForUser(CHAPTER, AUTHOR)).toEqual([]);
    });
  });

  it('the sweep deletes notes started more than thirty days ago', async () => {
    const { service, notes } = setup();
    await service.deleteExpired(new Date('2026-12-12T00:00:00.000Z'));
    expect(notes.deleteCreatedBefore).toHaveBeenCalledWith(
      '2026-11-12T00:00:00.000Z',
    );
  });
});
