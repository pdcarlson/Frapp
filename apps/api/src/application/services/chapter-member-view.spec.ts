import {
  CHAPTER_MEMBER_VIEW_FIELDS,
  toChapterMemberView,
} from './chapter-member-view';
import type { Chapter } from '../../domain/entities/chapter.entity';

/**
 * A chapter row as `select('*')` actually returns it — every column populated,
 * including the ones a member must never see. The point of the fixture is that
 * it is *complete*: a projection test against a sparse row proves nothing,
 * because the fields it should drop would be absent anyway.
 */
function fullChapterRow(): Chapter {
  return {
    id: 'ch-1',
    name: 'Alpha Beta',
    university: 'State U',
    stripe_customer_id: 'cus_SENSITIVE',
    subscription_status: 'past_due',
    subscription_id: 'sub_SENSITIVE',
    past_due_since: '2026-08-01T00:00:00.000Z',
    last_stripe_webhook_at: '2026-08-02T00:00:00.000Z',
    accent_color: '#8B0000',
    logo_path: 'chapters/ch-1/branding/logo.png',
    donation_url: 'https://example.test/give',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    org_archetype: 'fraternity',
    enabled_modules: { chat: true, dues: false },
    vocabulary: { member: 'brother' },
    branding: { greek_letters: 'ΑΒ' },
    theme_palette: { 'accent-text': '#B00020' },
    directory_id: 'dir-1',
    beta_config: { enabled: true, style: 'loud' },
    legal_accepted_at: '2026-01-01T00:00:00.000Z',
    legal_policy_version: '2026-01-01',
    legal_accepted_by: 'user-legal-signer',
    analytics_opt_out: false,
  };
}

describe('toChapterMemberView', () => {
  describe('AC #2 — billing identifiers never reach a member-permissioned route', () => {
    it.each(['stripe_customer_id', 'subscription_id'])('omits %s', (field) => {
      const view = toChapterMemberView(fullChapterRow());

      expect(view).not.toHaveProperty(field);
    });

    it('leaves no trace of the identifiers anywhere in the payload', () => {
      // Guards against a future field that embeds them (a `billing` blob, a
      // debug echo). `toHaveProperty` would miss that; a serialized scan does
      // not.
      const serialized = JSON.stringify(toChapterMemberView(fullChapterRow()));

      expect(serialized).not.toContain('cus_SENSITIVE');
      expect(serialized).not.toContain('sub_SENSITIVE');
    });
  });

  describe('internal and legal columns', () => {
    it.each([
      'last_stripe_webhook_at',
      'legal_accepted_at',
      'legal_policy_version',
      'legal_accepted_by',
      'beta_config',
      'directory_id',
    ])('omits %s', (field) => {
      expect(toChapterMemberView(fullChapterRow())).not.toHaveProperty(field);
    });
  });

  describe('AC #3 — the entitlement mirror cannot be broken silently', () => {
    /*
     * These two assertions are the whole reason this file exists. The client
     * subscription gate reads both fields off this payload, and
     * `isWithinSubscriptionGrace(null)` fails OPEN — so dropping either one
     * throws nothing, breaks no type, and leaves every client rendering
     * grace-window affordances while the server hard-locks the same writes.
     * If you are here because one of these failed: you removed a field the
     * client depends on, and the failure is the design working.
     */
    it('keeps subscription_status', () => {
      expect(toChapterMemberView(fullChapterRow()).subscription_status).toBe(
        'past_due',
      );
    });

    it('keeps past_due_since', () => {
      expect(toChapterMemberView(fullChapterRow()).past_due_since).toBe(
        '2026-08-01T00:00:00.000Z',
      );
    });

    it('preserves a null past_due_since rather than dropping the key', () => {
      // `'past_due_since' in view` is what distinguishes "not past due" from
      // "the server stopped sending it".
      const view = toChapterMemberView({
        ...fullChapterRow(),
        past_due_since: null,
      });

      expect(view).toHaveProperty('past_due_since');
      expect(view.past_due_since).toBeNull();
    });
  });

  describe('AC #4 — a new column is not exposed by default', () => {
    it('drops a column the projection has never heard of', () => {
      // Simulates the next migration adding a private column. The allowlist is
      // iterated, not subtracted from, so this passes without anyone editing
      // this file — which is the property under test.
      const withNewColumn = {
        ...fullChapterRow(),
        internal_risk_score: 'DO_NOT_SHIP',
      } as unknown as Chapter;

      const view = toChapterMemberView(withNewColumn);

      expect(view).not.toHaveProperty('internal_risk_score');
      expect(JSON.stringify(view)).not.toContain('DO_NOT_SHIP');
    });

    it('emits nothing outside the declared allowlist', () => {
      const view = toChapterMemberView(fullChapterRow());

      expect(Object.keys(view).sort()).toEqual(
        [...CHAPTER_MEMBER_VIEW_FIELDS].sort(),
      );
    });
  });

  describe('member-facing fields the shell renders from', () => {
    it('keeps identity, branding and config columns', () => {
      const view = toChapterMemberView(fullChapterRow());

      expect(view).toMatchObject({
        id: 'ch-1',
        name: 'Alpha Beta',
        university: 'State U',
        accent_color: '#8B0000',
        donation_url: 'https://example.test/give',
        org_archetype: 'fraternity',
        enabled_modules: { chat: true, dues: false },
        vocabulary: { member: 'brother' },
        branding: { greek_letters: 'ΑΒ' },
        theme_palette: { 'accent-text': '#B00020' },
        analytics_opt_out: false,
      });
    });

    it('leaves an absent optional key absent instead of setting it undefined', () => {
      // Narrower repository projections select only some columns;
      // materialising `vocabulary: undefined` would flip `'vocabulary' in
      // chapter` for downstream readers.
      const sparse = {
        id: 'ch-1',
        name: 'Alpha Beta',
        university: 'State U',
        stripe_customer_id: null,
        subscription_status: 'active',
        subscription_id: null,
        past_due_since: null,
        last_stripe_webhook_at: null,
        accent_color: null,
        logo_path: null,
        donation_url: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      } satisfies Chapter;

      const view = toChapterMemberView(sparse);

      expect(view).not.toHaveProperty('vocabulary');
      expect(view).not.toHaveProperty('enabled_modules');
      expect(view.subscription_status).toBe('active');
    });
  });
});
