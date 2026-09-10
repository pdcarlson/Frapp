import { SupabaseRushCandidateRepository } from './supabase-rush-candidate.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

const CANDIDATE_A = '0a000000-0000-4000-8000-000000000094';
const CANDIDATE_B = '0b000000-0000-4000-8000-000000000094';

const seed = () => ({
  rush_candidates: [
    inA({
      id: CANDIDATE_A,
      display_name: 'Jane Doe',
      name_key: 'jane doe',
      user_id: null,
      stage: 'new',
      bid_status: 'none',
      created_by: USER_SHARED,
      created_at: '2026-01-01T00:00:00.000Z',
    }),
    inB({
      id: CANDIDATE_B,
      display_name: 'Jane Doe',
      name_key: 'jane doe',
      user_id: null,
      stage: 'new',
      bid_status: 'none',
      created_by: USER_SHARED,
      created_at: '2026-01-01T00:00:00.000Z',
    }),
  ],
});

describe('SupabaseRushCandidateRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseRushCandidateRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseRushCandidateRepository(harness.client);
  });

  it('findById returns only the caller chapter candidate', async () => {
    const found = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findById(CANDIDATE_B, CHAPTER_B),
    );
    expect(found?.id).toBe(CANDIDATE_B);

    const leaked = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findById(CANDIDATE_A, CHAPTER_B),
    );
    expect(leaked).toBeNull();
  });

  it('findByNameKey returns only the caller chapter candidate', async () => {
    const found = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByNameKey(CHAPTER_B, 'jane doe'),
    );
    expect(found?.id).toBe(CANDIDATE_B);
  });

  it('setBidExtended refuses an id belonging to another chapter', async () => {
    await expect(
      harness.expectTenantScoped(CHAPTER_B, () =>
        repo.setBidExtended(CANDIDATE_A, CHAPTER_B),
      ),
    ).rejects.toMatchObject({ code: 'PGRST116' });

    expect(
      harness.rows('rush_candidates').find((r) => r.id === CANDIDATE_A)
        ?.bid_status,
    ).toBe('none');
  });

  it('countVotes and viewerHasVoted filter by chapter', async () => {
    harness = createTenantHarness({
      tables: {
        ...seed(),
        rush_candidate_votes: [
          inA({
            id: '0a000000-0000-4000-8000-000000000095',
            candidate_id: CANDIDATE_A,
            voter_id: USER_SHARED,
            created_at: '2026-01-01T00:00:00.000Z',
          }),
          inB({
            id: '0b000000-0000-4000-8000-000000000095',
            candidate_id: CANDIDATE_B,
            voter_id: USER_SHARED,
            created_at: '2026-01-01T00:00:00.000Z',
          }),
        ],
      },
      collisionExempt: { rush_candidate_votes: ['candidate_id'] },
    });
    repo = new SupabaseRushCandidateRepository(harness.client);

    const count = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.countVotes(CANDIDATE_B, CHAPTER_B),
    );
    expect(count).toBe(1);

    const leakedCount = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.countVotes(CANDIDATE_A, CHAPTER_B),
    );
    expect(leakedCount).toBe(0);

    const voted = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.viewerHasVoted(CANDIDATE_B, CHAPTER_B, USER_SHARED),
    );
    expect(voted).toBe(true);

    const leakedVote = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.viewerHasVoted(CANDIDATE_A, CHAPTER_B, USER_SHARED),
    );
    expect(leakedVote).toBe(false);
  });

  it('create stamps the caller chapter and does not write a twin', async () => {
    const created = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.create({
        chapter_id: CHAPTER_B,
        display_name: 'Pat Lee',
        user_id: null,
        stage: 'new',
        bid_status: 'none',
        created_by: USER_SHARED,
      }),
    );
    expect(created.chapter_id).toBe(CHAPTER_B);
    expect(
      harness
        .rows('rush_candidates')
        .filter((r) => r.display_name === 'Pat Lee'),
    ).toHaveLength(1);
  });

  it('insertVote writes only the caller chapter row', async () => {
    const outcome = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.insertVote(CANDIDATE_B, CHAPTER_B, USER_SHARED),
    );
    expect(outcome).toBe('inserted');
    expect(
      harness
        .rows('rush_candidate_votes')
        .filter((r) => r.chapter_id === CHAPTER_A),
    ).toHaveLength(0);
    expect(
      harness
        .rows('rush_candidate_votes')
        .filter((r) => r.candidate_id === CANDIDATE_B),
    ).toHaveLength(1);
  });
});
