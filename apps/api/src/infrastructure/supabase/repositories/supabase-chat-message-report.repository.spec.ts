import {
  HELD_OBJECTS_PAGE_SIZE,
  SupabaseChatMessageReportRepository,
} from './supabase-chat-message-report.repository';
import type { FrappSupabaseClient } from '../database.types';
import {
  CHAPTER_A,
  CHAPTER_B,
  USER_SHARED,
  USER_A,
  USER_B,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `chat_message_reports` (#2257).
 *
 * The table carries its own `chapter_id`, so the ordinary predicate check
 * applies — and it matters more here than on most tables, because the two
 * officer routes are reachable by any `channels:manage` holder and a report id
 * is a bare UUID. Without the chapter predicate on the resolve path, an officer
 * in one chapter could close another chapter's report.
 *
 * The seed pairs a chapter-A row with a chapter-B row that agrees on
 * *everything* except `id` and `chapter_id` — same reporter, same message, same
 * timestamps — so no predicate other than the tenant one can narrow the result.
 * Both statuses are seeded so the queue's status filter has something real to
 * exclude, and so is everything the officer paths now distinguish: a second
 * open report on the same message (the removal sweep), a resolved one on it
 * too (which the sweep must not touch), a report about `USER_SHARED` (left out
 * for that reviewer), and one on an imported message with no Frapp sender
 * (never left out — `NULL <> x` is not true, which is the trap a bare `.neq()`
 * falls into).
 *
 * `USER_B` is the reviewing officer wherever a test needs one who is not the
 * reported sender of anything seeded.
 */

const MESSAGE_ONE = '0c000000-0000-4000-8000-000000000201';
const MESSAGE_TWO = '0c000000-0000-4000-8000-000000000202';
const MESSAGE_THREE = '0c000000-0000-4000-8000-000000000205';
const MESSAGE_FOUR = '0c000000-0000-4000-8000-000000000206';

const REPORT_A_OPEN = '0a000000-0000-4000-8000-000000000210';
const REPORT_B_OPEN = '0b000000-0000-4000-8000-000000000210';
const REPORT_A_REVIEWED = '0a000000-0000-4000-8000-000000000211';
const REPORT_B_REVIEWED = '0b000000-0000-4000-8000-000000000211';
const REPORT_A_SIBLING = '0a000000-0000-4000-8000-000000000212';
const REPORT_B_SIBLING = '0b000000-0000-4000-8000-000000000212';
const REPORT_A_ABOUT_SHARED = '0a000000-0000-4000-8000-000000000213';
const REPORT_B_ABOUT_SHARED = '0b000000-0000-4000-8000-000000000213';
const REPORT_A_IMPORTED = '0a000000-0000-4000-8000-000000000214';
const REPORT_B_IMPORTED = '0b000000-0000-4000-8000-000000000214';
const REPORT_A_DISMISSED_SIBLING = '0a000000-0000-4000-8000-000000000215';
const REPORT_B_DISMISSED_SIBLING = '0b000000-0000-4000-8000-000000000215';

const openRow = () => ({
  reporter_user_id: USER_SHARED,
  message_id: MESSAGE_ONE,
  reported_content: 'the reported message',
  reported_sender_id: USER_A,
  reported_author_name: null,
  reason: 'harassment',
  details: null,
  status: 'open',
  created_at: '2026-02-02T00:00:00.000Z',
  resolved_at: null,
  resolved_by: null,
});

const reviewedRow = () => ({
  reporter_user_id: USER_SHARED,
  message_id: MESSAGE_TWO,
  reported_content: 'an older reported message',
  reported_sender_id: USER_A,
  reported_author_name: null,
  reason: 'spam',
  details: null,
  status: 'reviewed',
  created_at: '2026-02-01T00:00:00.000Z',
  resolved_at: '2026-02-01T06:00:00.000Z',
  resolved_by: USER_SHARED,
});

/** A second member's open report on MESSAGE_ONE — the removal sweep's sibling. */
const siblingRow = () => ({
  ...openRow(),
  reporter_user_id: USER_B,
  created_at: '2026-02-02T01:00:00.000Z',
});

/** An open report whose reported sender is USER_SHARED. */
const aboutSharedRow = () => ({
  ...openRow(),
  reporter_user_id: USER_A,
  message_id: MESSAGE_THREE,
  reported_sender_id: USER_SHARED,
  created_at: '2026-02-02T02:00:00.000Z',
});

/** An open report on an imported archive message: no Frapp sender at all. */
const importedRow = () => ({
  ...openRow(),
  reporter_user_id: USER_A,
  message_id: MESSAGE_FOUR,
  reported_sender_id: null,
  reported_author_name: 'imported-handle',
  created_at: '2026-02-02T03:00:00.000Z',
});

/** An already-dismissed report on MESSAGE_ONE, which the sweep must leave alone. */
const dismissedSiblingRow = () => ({
  ...openRow(),
  reporter_user_id: USER_A,
  status: 'dismissed',
  created_at: '2026-01-31T00:00:00.000Z',
  resolved_at: '2026-01-31T06:00:00.000Z',
  resolved_by: USER_SHARED,
});

const seed = () => ({
  chat_message_reports: [
    inA({ id: REPORT_A_OPEN, ...openRow() }),
    inA({ id: REPORT_A_REVIEWED, ...reviewedRow() }),
    inA({ id: REPORT_A_SIBLING, ...siblingRow() }),
    inA({ id: REPORT_A_ABOUT_SHARED, ...aboutSharedRow() }),
    inA({ id: REPORT_A_IMPORTED, ...importedRow() }),
    inA({ id: REPORT_A_DISMISSED_SIBLING, ...dismissedSiblingRow() }),
    inB({ id: REPORT_B_OPEN, ...openRow() }),
    inB({ id: REPORT_B_REVIEWED, ...reviewedRow() }),
    inB({ id: REPORT_B_SIBLING, ...siblingRow() }),
    inB({ id: REPORT_B_ABOUT_SHARED, ...aboutSharedRow() }),
    inB({ id: REPORT_B_IMPORTED, ...importedRow() }),
    inB({ id: REPORT_B_DISMISSED_SIBLING, ...dismissedSiblingRow() }),
  ],
});

describe('SupabaseChatMessageReportRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseChatMessageReportRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseChatMessageReportRepository(harness.client);
  });

  it('findByChapterAndStatus does not return the other chapter queue', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findByChapterAndStatus(CHAPTER_A, 'open', USER_B),
    );

    expect(rows.map((r) => r.id)).toEqual([
      REPORT_A_IMPORTED,
      REPORT_A_ABOUT_SHARED,
      REPORT_A_SIBLING,
      REPORT_A_OPEN,
    ]);
  });

  it('findByChapterAndStatus filters to the requested status', async () => {
    const rows = await repo.findByChapterAndStatus(
      CHAPTER_A,
      'reviewed',
      USER_B,
    );

    expect(rows.map((r) => r.id)).toEqual([REPORT_A_REVIEWED]);
  });

  it('findByChapterAndStatus leaves out reports about the reviewer, and keeps the imported one', async () => {
    // "The reporter is never disclosed to the reported member": an officer who
    // is the reported sender must not read the report, its note, or — for a
    // DM — deduce the reporter from it. An imported message has no Frapp
    // sender, and a bare `.neq()` would drop it too (NULL <> x is not true).
    const rows = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findByChapterAndStatus(CHAPTER_A, 'open', USER_SHARED),
    );

    expect(rows.map((r) => r.id)).toEqual([
      REPORT_A_IMPORTED,
      REPORT_A_SIBLING,
      REPORT_A_OPEN,
    ]);
  });

  it('never returns reporter_user_id to the caller', async () => {
    // The disclosure boundary, as a test rather than a comment. Nothing in this
    // app serializes to the declared DTO, so the repository's strip is the only
    // thing keeping the reporter off the wire — and the officer queue is read by
    // `channels:manage` holders, who can themselves be the reported member.
    const rows = await repo.findByChapterAndStatus(CHAPTER_A, 'open', USER_B);

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).not.toHaveProperty('reporter_user_id');
    }
  });

  it('resolve will not reach a report in another chapter', async () => {
    const result = await repo.resolve(
      REPORT_B_OPEN,
      CHAPTER_A,
      'dismissed',
      USER_SHARED,
      '2026-02-03T00:00:00.000Z',
    );

    expect(result).toBeNull();
    const untouched = harness
      .rows('chat_message_reports')
      .find((r) => r.id === REPORT_B_OPEN);
    expect(untouched?.status).toBe('open');
  });

  it('resolve stamps status, resolved_at and resolved_by inside the chapter', async () => {
    const resolved = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.resolve(
        REPORT_A_OPEN,
        CHAPTER_A,
        'actioned',
        USER_B,
        '2026-02-03T00:00:00.000Z',
      ),
    );

    expect(resolved).toMatchObject({
      id: REPORT_A_OPEN,
      status: 'actioned',
      resolved_at: '2026-02-03T00:00:00.000Z',
      resolved_by: USER_B,
    });
    expect(resolved).not.toHaveProperty('reporter_user_id');
  });

  it('resolve will not overwrite a report that is no longer open', async () => {
    // The compare-and-set. A stale client's Dismiss must not rewrite a report
    // another officer already closed.
    const result = await repo.resolve(
      REPORT_A_REVIEWED,
      CHAPTER_A,
      'dismissed',
      USER_B,
      '2026-02-03T00:00:00.000Z',
    );

    expect(result).toBeNull();
    expect(
      harness
        .rows('chat_message_reports')
        .find((r) => r.id === REPORT_A_REVIEWED),
    ).toMatchObject({
      status: 'reviewed',
      resolved_at: '2026-02-01T06:00:00.000Z',
      resolved_by: USER_SHARED,
    });
  });

  it('resolve will not let the reported member close a report about them', async () => {
    const result = await repo.resolve(
      REPORT_A_ABOUT_SHARED,
      CHAPTER_A,
      'dismissed',
      USER_SHARED,
      '2026-02-03T00:00:00.000Z',
    );

    expect(result).toBeNull();
    expect(
      harness
        .rows('chat_message_reports')
        .find((r) => r.id === REPORT_A_ABOUT_SHARED)?.status,
    ).toBe('open');
  });

  it('resolveOpenForMessage closes every open report on the message in the chapter, and nothing else', async () => {
    const closed = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.resolveOpenForMessage(
        CHAPTER_A,
        MESSAGE_ONE,
        'actioned',
        USER_B,
        '2026-02-03T00:00:00.000Z',
      ),
    );

    expect(closed.map((r) => r.id).sort()).toEqual(
      [REPORT_A_OPEN, REPORT_A_SIBLING].sort(),
    );
    for (const row of closed) {
      expect(row).toMatchObject({
        status: 'actioned',
        resolved_at: '2026-02-03T00:00:00.000Z',
        resolved_by: USER_B,
      });
      expect(row).not.toHaveProperty('reporter_user_id');
    }

    const stored = harness.rows('chat_message_reports');
    const byId = (id: string) => stored.find((r) => r.id === id);
    // An already-dismissed report on the same message keeps its decision.
    expect(byId(REPORT_A_DISMISSED_SIBLING)).toMatchObject({
      status: 'dismissed',
      resolved_by: USER_SHARED,
    });
    // Other messages, and the other chapter's twins, are untouched.
    expect(byId(REPORT_A_ABOUT_SHARED)?.status).toBe('open');
    expect(byId(REPORT_B_OPEN)?.status).toBe('open');
    expect(byId(REPORT_B_SIBLING)?.status).toBe('open');
  });

  it('findById does not reach a report in another chapter', async () => {
    // The report-scoped removal (#2311) authorizes off this row, so a foreign
    // report resolving here would hand an officer another chapter's message.
    const result = await repo.findById(REPORT_B_OPEN, CHAPTER_A, USER_B);

    expect(result).toBeNull();
  });

  it('findById does not return a report about the reviewer', async () => {
    const result = await repo.findById(
      REPORT_A_ABOUT_SHARED,
      CHAPTER_A,
      USER_SHARED,
    );

    expect(result).toBeNull();
  });

  it('findById returns a report on an imported message, which names no Frapp sender', async () => {
    const found = await repo.findById(REPORT_A_IMPORTED, CHAPTER_A, USER_B);

    expect(found).toMatchObject({
      id: REPORT_A_IMPORTED,
      reported_sender_id: null,
    });
  });

  it('findById returns the chapter report whatever its status, without the reporter', async () => {
    const found = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findById(REPORT_A_REVIEWED, CHAPTER_A, USER_B),
    );

    expect(found).toMatchObject({
      id: REPORT_A_REVIEWED,
      status: 'reviewed',
      message_id: MESSAGE_TWO,
    });
    expect(found).not.toHaveProperty('reporter_user_id');
  });

  it("findOwnOpenReport returns the caller's own open report in the chapter, and nobody else's", async () => {
    const found = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findOwnOpenReport(CHAPTER_A, USER_SHARED, MESSAGE_ONE),
    );

    expect(found?.id).toBe(REPORT_A_OPEN);
    expect(found).not.toHaveProperty('reporter_user_id');
    // USER_B's open report on the same message is not USER_SHARED's.
    expect(
      await repo.findOwnOpenReport(CHAPTER_A, USER_A, MESSAGE_ONE),
    ).toBeNull();
    // A resolved report is not a replay.
    expect(
      await repo.findOwnOpenReport(CHAPTER_A, USER_SHARED, MESSAGE_TWO),
    ).toBeNull();
  });

  it('releaseClaim puts back a claim carrying exactly its stamp, inside the chapter', async () => {
    const at = '2026-02-03T00:00:00.000Z';
    await repo.resolve(REPORT_A_OPEN, CHAPTER_A, 'actioned', USER_B, at);

    const released = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.releaseClaim(REPORT_A_OPEN, CHAPTER_A, USER_B, at),
    );

    expect(released).toBe(true);
    expect(
      harness.rows('chat_message_reports').find((r) => r.id === REPORT_A_OPEN),
    ).toMatchObject({ status: 'open', resolved_at: null, resolved_by: null });
  });

  it('releaseClaim leaves alone a report some other decision closed', async () => {
    // Another officer's stamp, another timestamp, another status, another
    // chapter: none of them is this request's claim, and none may reopen.
    const at = '2026-02-03T00:00:00.000Z';
    await repo.resolve(REPORT_A_OPEN, CHAPTER_A, 'actioned', USER_B, at);
    await repo.resolve(REPORT_B_OPEN, CHAPTER_B, 'actioned', USER_B, at);

    expect(
      await repo.releaseClaim(REPORT_A_OPEN, CHAPTER_A, USER_SHARED, at),
    ).toBe(false);
    expect(
      await repo.releaseClaim(
        REPORT_A_OPEN,
        CHAPTER_A,
        USER_B,
        '2026-02-03T00:00:01.000Z',
      ),
    ).toBe(false);
    expect(
      await repo.releaseClaim(
        REPORT_A_REVIEWED,
        CHAPTER_A,
        USER_SHARED,
        '2026-02-01T06:00:00.000Z',
      ),
    ).toBe(false);
    expect(await repo.releaseClaim(REPORT_B_OPEN, CHAPTER_A, USER_B, at)).toBe(
      false,
    );

    const byId = (id: string) =>
      harness.rows('chat_message_reports').find((r) => r.id === id);
    expect(byId(REPORT_A_OPEN)?.status).toBe('actioned');
    expect(byId(REPORT_A_REVIEWED)?.status).toBe('reviewed');
    expect(byId(REPORT_B_OPEN)?.status).toBe('actioned');
  });

  it('closeForDeletedMessage closes an open report as actioned with no reviewer', async () => {
    const closed = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.closeForDeletedMessage(
        REPORT_A_OPEN,
        CHAPTER_A,
        '2026-02-03T00:00:00.000Z',
      ),
    );

    expect(closed).toBe(true);
    expect(
      harness.rows('chat_message_reports').find((r) => r.id === REPORT_A_OPEN),
    ).toMatchObject({
      status: 'actioned',
      resolved_at: '2026-02-03T00:00:00.000Z',
      resolved_by: null,
    });
  });

  it("closeForDeletedMessage touches neither a resolved report nor another chapter's", async () => {
    expect(
      await repo.closeForDeletedMessage(
        REPORT_A_REVIEWED,
        CHAPTER_A,
        '2026-02-03T00:00:00.000Z',
      ),
    ).toBe(false);
    expect(
      await repo.closeForDeletedMessage(
        REPORT_B_OPEN,
        CHAPTER_A,
        '2026-02-03T00:00:00.000Z',
      ),
    ).toBe(false);

    const byId = (id: string) =>
      harness.rows('chat_message_reports').find((r) => r.id === id);
    expect(byId(REPORT_A_REVIEWED)).toMatchObject({
      status: 'reviewed',
      resolved_by: USER_SHARED,
    });
    expect(byId(REPORT_B_OPEN)?.status).toBe('open');
  });

  it('create stamps the chapter it is given and never writes into another', async () => {
    const { report: created, created: wasCreated } =
      await harness.expectTenantScoped(CHAPTER_B, () =>
        repo.create({
          chapter_id: CHAPTER_B,
          message_id: '0c000000-0000-4000-8000-000000000203',
          reporter_user_id: USER_A,
          reported_content: 'something new',
          reported_sender_id: USER_SHARED,
          reported_author_name: null,
          reported_attachments: [],
          reason: 'other',
          details: null,
        }),
      );

    expect(wasCreated).toBe(true);
    expect(created.chapter_id).toBe(CHAPTER_B);
    expect(created).not.toHaveProperty('reporter_user_id');
  });

  it('create snapshots the evidence rather than a reference to the message', async () => {
    await repo.create({
      chapter_id: CHAPTER_A,
      message_id: '0c000000-0000-4000-8000-000000000204',
      reporter_user_id: USER_A,
      reported_content: 'go away',
      reported_sender_id: null,
      reported_author_name: 'imported-handle',
      reported_attachments: [],
      reason: 'harassment',
      details: 'third time today',
    });

    const written = harness
      .rows('chat_message_reports')
      .find((r) => r.message_id === '0c000000-0000-4000-8000-000000000204');
    expect(written).toMatchObject({
      reported_content: 'go away',
      // Null sender + a name is the Discord-imported shape. Both halves are
      // written, so the officer still has an author once the import purge
      // hard-deletes the message and `message_id` goes NULL.
      reported_sender_id: null,
      reported_author_name: 'imported-handle',
      details: 'third time today',
    });
  });
});

/**
 * What a report holds as evidence (#2481): the attachments it snapshotted, the
 * hold every purge honours until it is released, and the release once it
 * resolves.
 *
 * Its own seed, twinned across chapters like the one above, so each read can be
 * shown not to reach the other chapter's evidence. Reports hold objects, not
 * messages, so the seed carries no message rows.
 */
describe('SupabaseChatMessageReportRepository — evidence (#2481)', () => {
  const photo = {
    bucket: 'chat',
    storage_path: 'chapters/a/chat/c/u/photo.png',
    filename: 'photo.png',
    content_type: 'image/png',
    byte_size: 4096,
  };
  const clip = {
    bucket: 'chat-archive',
    storage_path: 'chapters/a/archive/i/media/clip.gif',
    filename: 'clip.gif',
    content_type: null,
    byte_size: null,
  };

  // Every row is seeded in both chapters (`inA` / `inB` twins), so a read
  // that loses its chapter predicate returns the twin and fails.
  const HOLDING = '0a000000-0000-4000-8000-000000000301';
  const HOLDING_B = '0b000000-0000-4000-8000-000000000301';
  const EMPTY = '0a000000-0000-4000-8000-000000000302';
  const PENDING = '0a000000-0000-4000-8000-000000000303';
  const PENDING_B = '0b000000-0000-4000-8000-000000000303';
  const RELEASED = '0a000000-0000-4000-8000-000000000304';
  const LATE = '0a000000-0000-4000-8000-000000000305';
  const ABOUT_REVIEWER = '0a000000-0000-4000-8000-000000000306';

  const row = (overrides: Record<string, unknown>) => ({
    ...openRow(),
    reported_attachments: [photo],
    evidence_released_at: null,
    ...overrides,
  });
  const resolved = (at: string) => ({
    status: 'actioned',
    resolved_at: at,
    resolved_by: USER_B,
    reported_attachments: [clip],
  });
  const twin = (id: string) => id.replace(/^0a/, '0b');
  const seeded: [string, Record<string, unknown>][] = [
    [HOLDING, {}],
    [EMPTY, { reported_attachments: [] }],
    [PENDING, resolved('2026-02-02T01:00:00.000Z')],
    [
      RELEASED,
      {
        ...resolved('2026-02-02T00:30:00.000Z'),
        evidence_released_at: '2026-02-02T00:31:00.000Z',
      },
    ],
    [LATE, resolved('2026-02-02T05:00:00.000Z')],
    [ABOUT_REVIEWER, { reported_sender_id: USER_B }],
  ];

  let harness: TenantHarness;
  let repo: SupabaseChatMessageReportRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: {
        chat_message_reports: seeded.flatMap(([id, overrides]) => [
          inA(row({ id, ...overrides })),
          inB(row({ id: twin(id), ...overrides })),
        ]),
      },
    });
    repo = new SupabaseChatMessageReportRepository(harness.client);
  });

  it('create writes the attachment snapshot, and hands back only what the queue may see of it', async () => {
    const { report } = await repo.create({
      chapter_id: CHAPTER_A,
      message_id: '0c000000-0000-4000-8000-000000000307',
      reporter_user_id: USER_A,
      reported_content: '',
      reported_sender_id: USER_SHARED,
      reported_author_name: null,
      reported_attachments: [photo, clip],
      reason: 'sexual',
      details: null,
    });

    const written = harness
      .rows('chat_message_reports')
      .find((r) => r.message_id === '0c000000-0000-4000-8000-000000000307');
    expect(written?.reported_attachments).toEqual([photo, clip]);
    expect(report.reported_attachments).toEqual([
      { filename: 'photo.png', content_type: 'image/png', byte_size: 4096 },
      { filename: 'clip.gif', content_type: null, byte_size: null },
    ]);
  });

  it('never returns a storage location or the release stamp to the queue', async () => {
    // USER_SHARED reviews: USER_A is these reports' reported sender, and a
    // report about the reviewer is left out of their queue.
    const rows = await repo.findByChapterAndStatus(
      CHAPTER_A,
      'actioned',
      USER_SHARED,
    );

    expect(rows.length).toBeGreaterThan(0);
    for (const report of rows) {
      expect(report).not.toHaveProperty('evidence_released_at');
      expect(JSON.stringify(report.reported_attachments)).not.toContain(
        'chapters/',
      );
    }
  });

  it("findHeldObjects returns every object a report in the chapter still holds, once, and nothing else's", async () => {
    const held = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findHeldObjects(CHAPTER_A),
    );

    // The photo: HOLDING and ABOUT_REVIEWER are open. The clip: PENDING and
    // LATE are resolved and not yet released, so they still hold it (a
    // removal's claim in flight looks exactly like them), since the later of
    // the two resolved. RELEASED holds nothing any more, EMPTY never did, and
    // B's twins are another chapter's.
    expect(held).toEqual([
      {
        bucket: 'chat',
        storage_path: photo.storage_path,
        heldOpen: true,
        pendingSince: null,
      },
      {
        bucket: 'chat-archive',
        storage_path: clip.storage_path,
        heldOpen: false,
        pendingSince: '2026-02-02T05:00:00.000Z',
      },
    ]);
  });

  it('findHeldObjects says an object an open report holds is held open, whatever resolved report also holds it', async () => {
    const both = createTenantHarness({
      tables: {
        chat_message_reports: [
          [HOLDING, { reported_attachments: [clip] }],
          [PENDING, resolved('2026-02-02T01:00:00.000Z')],
        ].flatMap(([id, overrides]) => [
          inA(row({ id, ...(overrides as object) })),
          inB(row({ id: twin(id as string), ...(overrides as object) })),
        ]),
      },
    });

    await expect(
      new SupabaseChatMessageReportRepository(both.client).findHeldObjects(
        CHAPTER_A,
      ),
    ).resolves.toEqual([
      {
        bucket: 'chat-archive',
        storage_path: clip.storage_path,
        heldOpen: true,
        pendingSince: '2026-02-02T01:00:00.000Z',
      },
    ]);
  });

  it('findHeldObjects dates an object by its latest-resolved holder, whatever order their ids read in', async () => {
    // Ids are random, so the holder read last is not the one that resolved
    // last: here the lower id (PENDING) resolved later. A last-read-wins
    // merge would date the clip 01:00 and let a release delete it while
    // PENDING's claim could still be withdrawn.
    const swapped = createTenantHarness({
      tables: {
        chat_message_reports: [
          [PENDING, resolved('2026-02-02T05:00:00.000Z')],
          [LATE, resolved('2026-02-02T01:00:00.000Z')],
        ].flatMap(([id, overrides]) => [
          inA(row({ id, ...(overrides as object) })),
          inB(row({ id: twin(id as string), ...(overrides as object) })),
        ]),
      },
    });

    await expect(
      new SupabaseChatMessageReportRepository(swapped.client).findHeldObjects(
        CHAPTER_A,
      ),
    ).resolves.toEqual([
      {
        bucket: 'chat-archive',
        storage_path: clip.storage_path,
        heldOpen: false,
        pendingSince: '2026-02-02T05:00:00.000Z',
      },
    ]);
  });

  it('findHeldObjects leaves out the reports a release is releasing', async () => {
    const held = await repo.findHeldObjects(CHAPTER_A, [
      PENDING,
      LATE,
      HOLDING,
    ]);

    expect(held).toEqual([
      {
        bucket: 'chat',
        storage_path: photo.storage_path,
        heldOpen: true,
        pendingSince: null,
      },
    ]);
  });

  it('findEvidence reads a report as the reviewer may see it, storage location included', async () => {
    await expect(
      harness.expectTenantScoped(CHAPTER_A, () =>
        repo.findEvidence(HOLDING, CHAPTER_A, USER_SHARED),
      ),
    ).resolves.toEqual({
      id: HOLDING,
      chapter_id: CHAPTER_A,
      status: 'open',
      reported_attachments: [photo],
    });
    // Another chapter's report, and a report about the reviewer: both null.
    await expect(
      repo.findEvidence(HOLDING_B, CHAPTER_A, USER_SHARED),
    ).resolves.toBeNull();
    await expect(
      repo.findEvidence(ABOUT_REVIEWER, CHAPTER_A, USER_B),
    ).resolves.toBeNull();
  });

  it('findPendingRelease keeps only resolved, unreleased reports that hold something, in the chapter', async () => {
    const pending = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findPendingRelease(CHAPTER_A, [
        HOLDING,
        EMPTY,
        PENDING,
        PENDING_B,
        RELEASED,
        LATE,
      ]),
    );

    expect(pending.map(({ id }) => id).sort()).toEqual([LATE, PENDING].sort());
    await expect(repo.findPendingRelease(CHAPTER_A, [])).resolves.toEqual([]);
  });

  it('listPendingRelease reads every chapter in id order, after the cursor, up to the cutoff and the limit', async () => {
    // Cross-chapter by design: the hourly sweep serves the whole database.
    const beforeLate = await repo.listPendingRelease(
      '2026-02-02T04:00:00.000Z',
      10,
    );
    expect(beforeLate.map(({ id }) => id)).toEqual([PENDING, PENDING_B]);

    const firstPage = await repo.listPendingRelease(
      '2026-02-03T00:00:00.000Z',
      1,
    );
    expect(firstPage.map(({ id }) => id)).toEqual([PENDING]);
    expect(firstPage[0].reported_attachments).toEqual([clip]);

    // The next page starts after the last id read, not at an offset, so a
    // report the sweep stamped on the way does not shift one past it.
    const nextPage = await repo.listPendingRelease(
      '2026-02-03T00:00:00.000Z',
      10,
      PENDING,
    );
    expect(nextPage.map(({ id }) => id)).toEqual([LATE, PENDING_B, twin(LATE)]);
  });

  it('markEvidenceReleased stamps a resolved report in the chapter, and never an open one', async () => {
    const at = '2026-02-02T06:00:00.000Z';
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.markEvidenceReleased(PENDING, CHAPTER_A, at),
    );
    await repo.markEvidenceReleased(HOLDING, CHAPTER_A, at);
    await repo.markEvidenceReleased(PENDING_B, CHAPTER_A, at);

    const byId = (id: string) =>
      harness.rows('chat_message_reports').find((r) => r.id === id);
    expect(byId(PENDING)?.evidence_released_at).toBe(at);
    expect(byId(HOLDING)?.evidence_released_at).toBeNull();
    expect(byId(PENDING_B)?.evidence_released_at).toBeNull();
  });

  it('releaseClaim clears the release stamp, so a reopened report holds again', async () => {
    const at = '2026-02-02T01:00:00.000Z';
    await repo.markEvidenceReleased(PENDING, CHAPTER_A, at);

    await expect(
      repo.releaseClaim(PENDING, CHAPTER_A, USER_B, at),
    ).resolves.toBe(true);
    expect(
      harness.rows('chat_message_reports').find((r) => r.id === PENDING),
    ).toMatchObject({ status: 'open', evidence_released_at: null });
  });
});

/**
 * The hold read across more than one page (#2481). Every holding report is on
 * the far side of `HELD_OBJECTS_PAGE_SIZE` but one, so a read that stopped
 * after its first page would miss the last holder, and a purge would delete
 * what it holds. With PostgREST's `db-max-rows` below the page size every page
 * comes back short, so a read that stopped on a short page fails too; and a
 * report whose release lands between two page reads must not shift a holder
 * out of the next page, as an offset would.
 */
describe('SupabaseChatMessageReportRepository — findHeldObjects across pages (#2481)', () => {
  const count = HELD_OBJECTS_PAGE_SIZE + 1;
  const id = (prefix: string, n: number) =>
    `${prefix}000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const holding = (n: number) => ({
    ...openRow(),
    reported_attachments: [
      {
        bucket: 'chat',
        storage_path: `chapters/a/chat/c/u/${n}.png`,
        filename: `${n}.png`,
        content_type: 'image/png',
        byte_size: 1,
      },
    ],
    evidence_released_at: null,
  });
  const seed = (maxRows?: number) =>
    createTenantHarness({
      tables: {
        chat_message_reports: Array.from({ length: count }, (_, n) => [
          inA({ id: id('0a', n), ...holding(n) }),
          inB({ id: id('0b', n), ...holding(n) }),
        ]).flat(),
      },
      maxRows,
    });

  it.each([
    ['a full first page', undefined],
    ['pages capped short by db-max-rows', 200],
  ])(
    'reads every page, so the holder past the first page still holds (%s)',
    async (_case, maxRows) => {
      const harness = seed(maxRows);
      const repo = new SupabaseChatMessageReportRepository(harness.client);

      const held = await repo.findHeldObjects(CHAPTER_A);

      expect(held).toHaveLength(count);
      expect(held.at(-1)).toEqual({
        bucket: 'chat',
        storage_path: `chapters/a/chat/c/u/${count - 1}.png`,
        heldOpen: true,
        pendingSince: null,
      });
    },
  );

  it('misses no holder when a report on an earlier page is released between page reads', async () => {
    const harness = seed(200);
    const from = harness.client.from as unknown as jest.Mock;
    const build = from.getMockImplementation()!;
    let reads = 0;
    // The second page's read starts after the first page's returned: stamp a
    // report the first page already read, as a concurrent release would.
    from.mockImplementation((table: string) => {
      reads += 1;
      if (reads === 2) {
        // The harness applies a write when it is awaited, synchronously.
        void build('chat_message_reports')
          .update({ evidence_released_at: '2026-02-02T00:00:00.000Z' })
          .eq('chapter_id', CHAPTER_A)
          .eq('id', id('0a', 0))
          .then(() => undefined);
      }
      return build(table);
    });
    const repo = new SupabaseChatMessageReportRepository(harness.client);

    const held = await repo.findHeldObjects(CHAPTER_A);

    expect(
      harness.rows('chat_message_reports').find((r) => r.id === id('0a', 0))
        ?.evidence_released_at,
    ).not.toBeNull();
    // The first page read report 0 before its release; every other report
    // still holds, including the one an offset would have stepped over.
    expect(held.map(({ storage_path }) => storage_path)).toEqual(
      Array.from({ length: count }, (_, n) => `chapters/a/chat/c/u/${n}.png`),
    );
  });
});

/**
 * The idempotency branch, driven by a hand-rolled double rather than the tenant
 * harness.
 *
 * The harness models PostgREST's *filtering*, not Postgres's constraints: its
 * `insert` appends unconditionally, so it can never raise the `23505` this
 * branch exists to translate. Everything the harness *can* prove about this
 * repository is proven above, under `createTenantHarness`; this block covers the
 * one path it structurally cannot reach.
 *
 * What is being pinned is that a duplicate OPEN report is not a 500. The index
 * is partial (`where status = 'open'`) and PostgREST will not use a partial
 * unique index as an `ON CONFLICT` arbiter, so the repository cannot upsert its
 * way out — it inserts, catches the unique violation, and re-selects.
 */
describe('SupabaseChatMessageReportRepository — duplicate open report', () => {
  const existingRow = {
    id: REPORT_A_OPEN,
    chapter_id: CHAPTER_A,
    message_id: MESSAGE_ONE,
    reporter_user_id: USER_SHARED,
    reported_content: 'the reported message',
    reported_sender_id: USER_A,
    reported_author_name: null,
    reason: 'harassment',
    details: null,
    status: 'open',
    created_at: '2026-02-02T00:00:00.000Z',
    resolved_at: null,
    resolved_by: null,
  };

  const input = {
    chapter_id: CHAPTER_A,
    message_id: MESSAGE_ONE,
    reporter_user_id: USER_SHARED,
    reported_content: 'the reported message',
    reported_sender_id: USER_A,
    reported_author_name: null,
    reported_attachments: [],
    reason: 'harassment' as const,
    details: null,
  };

  /**
   * Minimal PostgREST double: the first `.insert(...).select().single()` answers
   * with `error`, and the following `.select()…maybeSingle()` answers with
   * `reselect`. `filters` records the re-select's predicates so the test can
   * assert the read-back is scoped to the caller's own tuple.
   */
  function createClient(options: {
    insertError: unknown;
    reselect: Record<string, unknown> | null;
  }) {
    const filters: Array<[string, unknown]> = [];
    const builder: Record<string, unknown> = {
      insert: jest.fn(() => builder),
      select: jest.fn(() => builder),
      eq: jest.fn((column: string, value: unknown) => {
        filters.push([column, value]);
        return builder;
      }),
      single: jest.fn(() =>
        Promise.resolve({ data: null, error: options.insertError }),
      ),
      maybeSingle: jest.fn(() =>
        Promise.resolve({ data: options.reselect, error: null }),
      ),
    };
    const from = jest.fn(() => builder);
    const client = { from } as unknown as FrappSupabaseClient;
    // `from` is returned, not just wired: without it nothing in this block
    // pinned the table name, so a repository that inserted into — and
    // re-selected from — some other table passed every assertion here.
    return { client, filters, from };
  }

  it('returns the existing open report instead of surfacing 23505', async () => {
    const { client, filters, from } = createClient({
      insertError: { code: '23505', message: 'duplicate key value' },
      reselect: existingRow,
    });
    const repo = new SupabaseChatMessageReportRepository(client);

    const { report: result, created } = await repo.create(input);

    expect(from).toHaveBeenCalledWith('chat_message_reports');
    expect(result.id).toBe(REPORT_A_OPEN);
    expect(result).not.toHaveProperty('reporter_user_id');
    // A replay, not a new report — `ChatReportService` keys the officer
    // notification off this, so reporting `true` here would re-page every
    // officer on each double-tap.
    expect(created).toBe(false);
    // Scoped to the caller's own tuple, so the read-back cannot hand over
    // somebody else's report on the same message.
    expect(filters).toEqual([
      ['chapter_id', CHAPTER_A],
      ['reporter_user_id', USER_SHARED],
      ['message_id', MESSAGE_ONE],
      ['status', 'open'],
    ]);
  });

  it('rethrows when the open report vanished between the insert and the re-select', async () => {
    // Resolved by an officer in the gap. Inventing a row here would be a lie
    // about what is in the queue; the honest answer is the original error, and
    // a retry then succeeds.
    const { client } = createClient({
      insertError: { code: '23505', message: 'duplicate key value' },
      reselect: null,
    });
    const repo = new SupabaseChatMessageReportRepository(client);

    await expect(repo.create(input)).rejects.toMatchObject({ code: '23505' });
  });

  it('rethrows an error that is not a unique violation', async () => {
    const { client } = createClient({
      insertError: { code: '23503', message: 'foreign key violation' },
      reselect: existingRow,
    });
    const repo = new SupabaseChatMessageReportRepository(client);

    await expect(repo.create(input)).rejects.toMatchObject({ code: '23503' });
  });
});
