import { EMPTY_MEETING_CONTENT } from '@repo/validation';
import type { IDocumentTextExtractor } from '#domain/adapters/document-text-extractor.interface';
import type { IStorageProvider } from '#domain/adapters/storage.interface';
import type { Meeting } from '#domain/entities/meeting.entity';
import type { IChapterDocumentRepository } from '#domain/repositories/chapter-document.repository.interface';
import type { IMeetingRepository } from '#domain/repositories/meeting.repository.interface';
import type { MeetingService } from '../meeting.service';
import type { RbacService } from '../rbac.service';
import { ChapterDocumentCorpusSource } from './chapter-document-corpus-source';
import {
  MeetingMinutesCorpusSource,
  minutesSections,
  minutesTitle,
} from './meeting-minutes-corpus-source';

const CHAPTER = '11111111-1111-4111-8111-111111111111';
const MEMBER = '44444444-4444-4444-8444-444444444444';
const OWNER = '55555555-5555-4555-8555-555555555555';

const meeting = (overrides: Partial<Meeting> = {}): Meeting => ({
  id: 'meeting-1',
  chapter_id: CHAPTER,
  event_id: 'event-1',
  event_name: 'Budget review',
  event_start_time: '2026-11-09T23:30:00.000Z',
  meeting_type: 'exec',
  other_label: null,
  status: 'posted',
  content: {
    ...EMPTY_MEETING_CONTENT,
    summary: 'We reviewed the fall budget.',
    decisions: [
      {
        text: 'Move formal to April 12.',
        vote: { for: 9, against: 2, abstain: 1 },
      },
      { text: 'Keep dues at $225.', vote: null },
    ],
    action_items: [
      { text: 'Book the venue.', owner_user_id: OWNER, due_date: '2026-11-20' },
      { text: 'Email the alumni board.', owner_user_id: null, due_date: null },
    ],
  },
  created_by: MEMBER,
  updated_by: MEMBER,
  posted_by: MEMBER,
  posted_at: '2026-11-10T01:00:00.000Z',
  created_at: '2026-11-10T00:00:00.000Z',
  updated_at: '2026-11-10T01:00:00.000Z',
  ...overrides,
});

describe('minutes as corpus text', () => {
  it('titles minutes by type, event and a written-out date', () => {
    expect(minutesTitle(meeting())).toBe(
      'Exec meeting minutes: Budget review, November 9, 2026',
    );
    expect(
      minutesTitle(
        meeting({ meeting_type: 'other', other_label: 'Housing corp' }),
      ),
    ).toBe('Housing corp meeting minutes: Budget review, November 9, 2026');
  });

  it('renders one section per filled part, with votes and due days in words, and no member’s name', () => {
    const sections = minutesSections(meeting().content as never);
    expect(sections).toEqual([
      { heading: 'Summary', page: null, text: 'We reviewed the fall budget.' },
      {
        heading: 'Decisions',
        page: null,
        text: 'Move formal to April 12. (Vote: 9 for, 2 against, 1 abstaining.)\n\nKeep dues at $225.',
      },
      {
        heading: 'Action items',
        page: null,
        text: 'Book the venue. (Due November 20, 2026.)\n\nEmail the alumni board.',
      },
    ]);
  });

  it('writes a due day that is not on the calendar as it was stored', () => {
    const content = {
      ...EMPTY_MEETING_CONTENT,
      action_items: [
        { text: 'A', owner_user_id: null, due_date: '2026-13-01' },
        { text: 'B', owner_user_id: null, due_date: '2026-02-30' },
      ],
    };
    expect(minutesSections(content as never)[0].text).toBe(
      'A (Due 2026-13-01.)\n\nB (Due 2026-02-30.)',
    );
  });
});

describe('MeetingMinutesCorpusSource', () => {
  function setup(row: Meeting | null = meeting()) {
    const meetings = {
      findById: jest.fn().mockResolvedValue(row),
    } as unknown as jest.Mocked<IMeetingRepository>;
    const readableAmong = jest
      .fn()
      .mockImplementation((_c: string, _u: string, ids: string[]) =>
        Promise.resolve(new Set(ids)),
      );
    const source = new MeetingMinutesCorpusSource(meetings, {
      readableAmong,
    } as unknown as MeetingService);
    return { source, meetings, readableAmong };
  }

  it('reads posted minutes as dated, decaying text', async () => {
    const { source } = setup();
    const read = await source.read(CHAPTER, 'meeting-1');
    expect(read).toEqual({
      status: 'ok',
      content: expect.objectContaining({
        title: 'Exec meeting minutes: Budget review, November 9, 2026',
        sourceAt: '2026-11-09T23:30:00.000Z',
        decays: true,
      }),
    });
  });

  it('treats a draft, or minutes that are gone, as nothing to index', async () => {
    await expect(
      setup(meeting({ status: 'draft', posted_at: null })).source.read(
        CHAPTER,
        'meeting-1',
      ),
    ).resolves.toEqual({ status: 'gone' });
    await expect(setup(null).source.read(CHAPTER, 'x')).resolves.toEqual({
      status: 'gone',
    });
  });

  it('skips posted minutes with nothing written in them', async () => {
    await expect(
      setup(meeting({ content: {} })).source.read(CHAPTER, 'meeting-1'),
    ).resolves.toEqual({ status: 'skipped', reason: 'no_text' });
  });

  it('asks the minutes rule once for the whole list, and keeps what it lets in', async () => {
    const { source, meetings, readableAmong } = setup();
    meetings.findById.mockImplementation((_chapter: string, id: string) =>
      Promise.resolve(meeting({ id })),
    );
    readableAmong.mockResolvedValue(new Set(['chapter-meeting']));
    await expect(
      source.readableBy(CHAPTER, MEMBER, [
        'exec-meeting',
        'chapter-meeting',
        'chapter-meeting',
      ]),
    ).resolves.toEqual(new Set(['chapter-meeting']));
    expect(readableAmong.mock.calls).toEqual([
      [CHAPTER, MEMBER, ['exec-meeting', 'chapter-meeting']],
    ]);
  });

  it('never returns a draft as readable, even to the author the rule would let in', async () => {
    const { source } = setup(meeting({ status: 'draft', posted_at: null }));
    await expect(
      source.readableBy(CHAPTER, MEMBER, ['meeting-1']),
    ).resolves.toEqual(new Set());
  });
});

describe('ChapterDocumentCorpusSource', () => {
  const document = {
    id: 'doc-1',
    chapter_id: CHAPTER,
    title: 'Bylaws',
    storage_path: `${CHAPTER}/abc/bylaws-2026.pdf`,
    content_type: 'application/pdf',
    effective_date: '2026-08-15',
    created_at: '2026-09-01T12:00:00.000Z',
  };

  function setup(row: typeof document | null = document) {
    const documents = {
      findById: jest.fn().mockResolvedValue(row),
    } as unknown as jest.Mocked<IChapterDocumentRepository>;
    const storage = {
      downloadFile: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    } as unknown as jest.Mocked<IStorageProvider>;
    const extractor: jest.Mocked<IDocumentTextExtractor> = {
      extract: jest.fn().mockResolvedValue({
        status: 'ok',
        sections: [{ heading: null, page: 1, text: 'Dues are $225.' }],
      }),
    };
    const memberHasAnyPermission = jest.fn().mockResolvedValue(true);
    const source = new ChapterDocumentCorpusSource(
      documents,
      storage,
      extractor,
      {
        memberHasAnyPermission,
      } as unknown as RbacService,
    );
    return { source, documents, storage, extractor, memberHasAnyPermission };
  }

  it('reads the file from the documents bucket and dates it by its effective date', async () => {
    const { source, documents, storage, extractor } = setup();
    await expect(source.read(CHAPTER, 'doc-1')).resolves.toEqual({
      status: 'ok',
      content: {
        title: 'Bylaws',
        sourceAt: '2026-08-15T00:00:00.000Z',
        decays: false,
        sections: [{ heading: null, page: 1, text: 'Dues are $225.' }],
      },
    });
    expect(documents.findById).toHaveBeenCalledWith('doc-1', CHAPTER);
    expect(storage.downloadFile).toHaveBeenCalledWith(
      'documents',
      document.storage_path,
    );
    expect(extractor.extract).toHaveBeenCalledWith({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'application/pdf',
      fileName: 'bylaws-2026.pdf',
    });
  });

  it('falls back to the upload time when no effective date was given', async () => {
    const { source } = setup({ ...document, effective_date: null as never });
    const read = await source.read(CHAPTER, 'doc-1');
    expect(read.status === 'ok' && read.content.sourceAt).toBe(
      '2026-09-01T12:00:00.000Z',
    );
  });

  it('reports a deleted document as gone, a missing file as unreadable, and passes a skip through', async () => {
    await expect(setup(null).source.read(CHAPTER, 'x')).resolves.toEqual({
      status: 'gone',
    });
    const missing = setup();
    missing.storage.downloadFile.mockResolvedValue(null);
    await expect(missing.source.read(CHAPTER, 'doc-1')).resolves.toEqual({
      status: 'skipped',
      reason: 'unreadable',
    });
    const scanned = setup();
    scanned.extractor.extract.mockResolvedValue({
      status: 'skipped',
      reason: 'no_text',
    });
    await expect(scanned.source.read(CHAPTER, 'doc-1')).resolves.toEqual({
      status: 'skipped',
      reason: 'no_text',
    });
  });

  it('lets a member read every document when they may open the library, and none otherwise', async () => {
    const { source, memberHasAnyPermission } = setup();
    await expect(
      source.readableBy(CHAPTER, MEMBER, ['doc-1', 'doc-2']),
    ).resolves.toEqual(new Set(['doc-1', 'doc-2']));
    expect(memberHasAnyPermission).toHaveBeenCalledWith(CHAPTER, MEMBER, [
      'members:view',
    ]);
    memberHasAnyPermission.mockResolvedValue(false);
    await expect(
      source.readableBy(CHAPTER, MEMBER, ['doc-1']),
    ).resolves.toEqual(new Set());
  });
});
