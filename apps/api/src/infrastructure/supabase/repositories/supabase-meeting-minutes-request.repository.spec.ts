import { SupabaseMeetingMinutesRequestRepository } from './supabase-meeting-minutes-request.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `meeting_minutes_requests` (#5471). A row says a member
 * asked for a meeting's unposted minutes, so a chapter filter that slipped
 * would tell one chapter's member they had asked in another.
 */

// The same meeting and member in both chapters, so only the chapter filter
// separates them (the harness's rule for twins).
const MEETING = '0c000000-0000-4000-8000-0000000000b1';
const MEMBER = '0c000000-0000-4000-8000-0000000000b2';

const row = {
  meeting_id: MEETING,
  user_id: MEMBER,
  created_at: '2026-11-19T00:00:00.000Z',
  announced_at: null,
};

describe('SupabaseMeetingMinutesRequestRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseMeetingMinutesRequestRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: {
        meeting_minutes_requests: [
          inA({ id: 'request-a', ...row }),
          inB({ id: 'request-b', ...row }),
        ],
      },
      rpc: {
        request_meeting_minutes: {
          data: [{ requested: true, ping: true, asked: 2 }],
        },
        release_meeting_minutes_ping: { data: null },
      },
    });
    repo = new SupabaseMeetingMinutesRequestRepository(harness.client);
  });

  it("hasRequested reads only the caller chapter's requests", async () => {
    await expect(
      harness.expectTenantScoped(CHAPTER_B, () =>
        repo.hasRequested(CHAPTER_B, MEETING, MEMBER),
      ),
    ).resolves.toBe(true);
  });

  it('request passes the caller chapter to the RPC', async () => {
    const outcome = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.request(CHAPTER_A, MEETING, MEMBER, 86_400),
    );
    expect(outcome).toEqual({ requested: true, ping: true, asked: 2 });
    expect(harness.rpcCalls[0].args).toMatchObject({
      p_meeting_id: MEETING,
      p_user_id: MEMBER,
      p_cooldown_seconds: 86_400,
    });
  });

  it('release passes the caller chapter to the RPC', async () => {
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.release(CHAPTER_A, MEETING, MEMBER),
    );
    expect(harness.rpcCalls[0]).toMatchObject({
      fn: 'release_meeting_minutes_ping',
      args: { p_meeting_id: MEETING, p_user_id: MEMBER },
    });
  });
});
