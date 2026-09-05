// These are behavioural test doubles, not a module-resolution workaround: the
// `@repo/*` dists are CJS and import fine here (the `@repo/validation` mock
// below spreads the real module, and custom-field-provisioning.spec.ts imports
// CUSTOM_FIELDS_SEED directly). An earlier version of this comment claimed they
// were ESM-only and untransformable — they are not; the symptom behind that was
// an unbuilt `dist`, fixed by building the packages.
//
// The two below are stubbed so this file exercises onboarding *orchestration*
// against a fixed archetype/palette rather than the real seed's contents.
jest.mock('@repo/org-archetypes', () => ({
  buildChapterConfigFromArchetype: jest.fn((key: string) => ({
    archetype: key,
    modules: { chat: true, members: true, announcements: true },
    rolePack: 'test_pack',
    vocabulary: {
      recruitment: 'Rush',
      pledge: 'New member',
      class: 'Pledge class',
    },
    customFields: [],
    workflows: [],
    dues: {},
  })),
  getArchetype: jest.fn((key: string) => ({ key, label: key })),
}));
jest.mock('@repo/chapter-theme', () => ({
  // Mirrors the real DeriveSignetPaletteResult shape. Returning a partial
  // object here hid a live defect once: the service read a result field
  // unguarded, threw, and the surrounding try/catch turned that into a silently
  // missing theme_palette. The service reads `invalidSeed` and iterates
  // `contrastChecks`. Keep this in step with packages/chapter-theme.
  deriveSignetPalette: jest.fn(() => ({
    palette: { '--signet-accent-primary': '#C49A3A' },
    resolvedSeed: '#F2B72E',
    invalidSeed: false,
    contrastChecks: [
      {
        role: '--signet-accent-text',
        against: '#0E0D0B',
        ratio: 7.2,
        passes: true,
      },
    ],
  })),
}));
// Only the policy version is stubbed. The rest must stay real: the seeding path
// validates every candidate row with the actual `CreateCustomFieldSchema`, so a
// bare stub here would silently make that validation a no-op.
jest.mock('@repo/validation', () => ({
  ...jest.requireActual('@repo/validation'),
  LEGAL_POLICY_VERSION: 'test-version',
}));

import { Test, TestingModule } from '@nestjs/testing';
import { buildChapterConfigFromArchetype } from '@repo/org-archetypes';
import { ChapterOnboardingService } from './chapter-onboarding.service';
import { ChapterService } from './chapter.service';
import { ActivationService } from './activation.service';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import type { Chapter } from '../../domain/entities/chapter.entity';
import type { ChapterOnboardingDto } from '../../interface/dtos/chapter-onboarding.dto';

const SYSTEM_SENDER_ID = '00000000-0000-0000-0000-000000000000';

function makeChapter(): Chapter {
  return {
    id: 'ch-1',
    name: 'Sigma Phi Epsilon',
    university: 'UCLA',
    stripe_customer_id: null,
    subscription_status: 'incomplete',
    subscription_id: null,
    past_due_since: null,
    last_stripe_webhook_at: null,
    accent_color: null,
    logo_path: null,
    donation_url: null,
    created_at: '2026-05-24',
    updated_at: '2026-05-24',
  };
}

describe('ChapterOnboardingService', () => {
  let service: ChapterOnboardingService;
  let chapterService: { create: jest.Mock };
  let channelQuery: {
    select: jest.Mock;
    eq: jest.Mock;
    maybeSingle: jest.Mock;
  };
  let mockActivation: jest.Mocked<Pick<ActivationService, 'record'>>;
  let messageInsert: jest.Mock;
  let requestInsert: jest.Mock;
  let fieldsUpsert: jest.Mock;
  let from: jest.Mock;

  beforeEach(async () => {
    chapterService = { create: jest.fn().mockResolvedValue(makeChapter()) };
    mockActivation = { record: jest.fn().mockResolvedValue(true) };

    channelQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest
        .fn()
        .mockResolvedValue({ data: { id: 'chan-general' }, error: null }),
    };
    messageInsert = jest.fn().mockResolvedValue({ error: null });
    requestInsert = jest.fn().mockResolvedValue({ error: null });
    fieldsUpsert = jest.fn().mockResolvedValue({ error: null });
    from = jest.fn((table: string) => {
      if (table === 'chat_channels') return channelQuery;
      if (table === 'chat_messages') return { insert: messageInsert };
      if (table === 'chapter_directory_requests')
        return { insert: requestInsert };
      if (table === 'chapter_custom_fields') return { upsert: fieldsUpsert };
      return {};
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChapterOnboardingService,
        { provide: ChapterService, useValue: chapterService },
        { provide: SUPABASE_CLIENT, useValue: { from } },
        { provide: ActivationService, useValue: mockActivation },
      ],
    }).compile();

    service = module.get(ChapterOnboardingService);
  });

  const directoryDto: ChapterOnboardingDto = {
    name: 'Sigma Phi Epsilon',
    university: 'UCLA',
    accept_terms_privacy: true,
    org_archetype: 'nphc',
    directory_id: '11111111-1111-1111-1111-111111111111',
    branding: {
      greek_letters: 'ΣΦΕ',
      designation: 'California Eta',
      school_short: 'UCLA',
      founded_at: 1948,
      colors: { accent: '#C9A56F' },
    },
  };

  it('materializes config from the archetype seed and creates the chapter', async () => {
    await service.onboard('user-1', directoryDto);

    expect(chapterService.create).toHaveBeenCalledTimes(1);
    const [userId, payload] = chapterService.create.mock.calls[0];
    expect(userId).toBe('user-1');
    expect(payload.name).toBe('Sigma Phi Epsilon');
    expect(payload.university).toBe('UCLA');
    expect(payload.config.org_archetype).toBe('nphc');
    // enabled_modules comes from the archetype seed, not the client.
    expect(payload.config.enabled_modules).toMatchObject({ chat: true });
    expect(payload.config.directory_id).toBe(
      '11111111-1111-1111-1111-111111111111',
    );
    expect(payload.config.branding).toMatchObject({
      greek_letters: 'ΣΦΕ',
      designation: 'California Eta',
      founded_at: 1948,
      colors: { accent: '#C9A56F' },
    });
    // A derived theme palette is persisted when colors are supplied.
    expect(payload.config.theme_palette).toBeDefined();
  });

  describe('Signet accent map', () => {
    it('persists the Signet map alone — no legacy token survives', async () => {
      await service.onboard('user-1', directoryDto);

      const [, payload] = chapterService.create.mock.calls[0];
      expect(payload.config.theme_palette).toMatchObject({
        '--signet-accent-primary': '#C49A3A',
      });
      // The #920 slice-9 cutover deleted `derivePalette`, so the column now
      // holds one map rather than two merged together. Asserted by prefix
      // rather than by naming the eight dead keys: a reintroduced legacy
      // writer would not necessarily pick the same names.
      const written = Object.keys(
        payload.config.theme_palette as Record<string, string>,
      );
      expect(written.length).toBeGreaterThan(0);
      expect(written.every((key) => key.startsWith('--signet-'))).toBe(true);
    });

    it('writes the Signet map even when the chapter picked no colors', async () => {
      // `accent-engine.md` §3 defines the no-accent case as the house seed run
      // through the same pipeline, not as an absent palette — so the map is
      // written for every chapter, with no conditional half.
      const { colors: _dropped, ...brandingWithoutColors } =
        directoryDto.branding;
      await service.onboard('user-1', {
        ...directoryDto,
        branding: brandingWithoutColors,
      });

      const [, payload] = chapterService.create.mock.calls[0];
      expect(payload.config.theme_palette).toMatchObject({
        '--signet-accent-primary': '#C49A3A',
      });
    });

    it('seeds the engine from the branding accent, not a third read path', async () => {
      const { deriveSignetPalette } = jest.requireMock(
        '@repo/chapter-theme',
      ) as { deriveSignetPalette: jest.Mock };
      deriveSignetPalette.mockClear();

      await service.onboard('user-1', directoryDto);

      // #795: `chapters.accent_color` is a second source for this fact and can
      // disagree. Until that decision lands, no new read path.
      expect(deriveSignetPalette).toHaveBeenCalledWith('#C9A56F');
    });
  });

  describe('accent_color mirror (#795)', () => {
    it("writes the wizard's accent to the column, not just to branding", async () => {
      await service.onboard('user-1', directoryDto);

      const [, payload] = chapterService.create.mock.calls[0];
      // Before this, the column kept its schema default `#2563EB`, so every
      // surface reading `accent_color` — the dashboard shell, mobile branding,
      // the membership summary — showed Royal Blue for a chapter that had
      // picked something else. Only `theme_palette` readers saw the real color,
      // which is why it stayed invisible on web.
      expect(payload.config.accent_color).toBe('#C9A56F');
    });

    it('leaves the column unset when the wizard collects no accent', async () => {
      await service.onboard('user-1', {
        ...directoryDto,
        branding: { greek_letters: 'ΣΦΕ' },
      });

      const [, payload] = chapterService.create.mock.calls[0];
      // Absent, not defaulted here: the column's own schema default applies,
      // and writing a value the officer never chose would be worse than leaving
      // it to the render fallback.
      expect(payload.config.accent_color).toBeUndefined();
    });
  });

  it('records the onboarding-submitted activation milestone (#267)', async () => {
    await service.onboard('user-1', directoryDto);

    expect(mockActivation.record).toHaveBeenCalledWith(
      'ch-1',
      'activation-onboarding-submitted',
      { archetype: 'nphc' },
    );
  });

  it('stamps Terms/Privacy acceptance from the session actor + server clock', async () => {
    const before = Date.now();
    await service.onboard('user-1', directoryDto);

    const [, payload] = chapterService.create.mock.calls[0];
    expect(payload.config.legal_accepted_by).toBe('user-1');
    expect(payload.config.legal_policy_version).toBe('test-version');
    expect(typeof payload.config.legal_accepted_at).toBe('string');
    // Stamped from the server clock, never supplied by the client.
    const acceptedAt = new Date(payload.config.legal_accepted_at).getTime();
    expect(acceptedAt).toBeGreaterThanOrEqual(before);
    expect(acceptedAt).toBeLessThanOrEqual(Date.now());
  });

  it('posts a welcome system_audit message into #general', async () => {
    await service.onboard('user-1', directoryDto);

    expect(from).toHaveBeenCalledWith('chat_channels');
    expect(messageInsert).toHaveBeenCalledTimes(1);
    expect(messageInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_id: 'chan-general',
        sender_id: SYSTEM_SENDER_ID,
        kind: 'system_audit',
        content:
          'Welcome to ΣΦΕ California Eta. Invite your chapter to get the conversation started.',
      }),
    );
  });

  it('records a directory request for manual entry (no directory_id)', async () => {
    const manualDto: ChapterOnboardingDto = {
      name: 'Made Up Chapter Name',
      university: 'Nowhere State',
      accept_terms_privacy: true,
      org_archetype: 'ifc',
      branding: { greek_letters: 'ΑΒΓ', designation: 'Test', founded_at: 2020 },
    };

    await service.onboard('user-1', manualDto);

    expect(requestInsert).toHaveBeenCalledTimes(1);
    expect(requestInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        chapter_id: 'ch-1',
        requested_by: 'user-1',
        org_name: 'Made Up Chapter Name',
        university: 'Nowhere State',
        archetype: 'ifc',
        founded_year: 2020,
      }),
    );
  });

  it('records the effective archetype (not null) when the DTO omits one', async () => {
    const manualDto: ChapterOnboardingDto = {
      name: 'No Archetype Chapter',
      university: 'Somewhere',
      accept_terms_privacy: true,
    };

    await service.onboard('user-1', manualDto);

    expect(requestInsert).toHaveBeenCalledWith(
      expect.objectContaining({ archetype: 'ifc' }),
    );
  });

  it('does not record a directory request when a directory match is provided', async () => {
    await service.onboard('user-1', directoryDto);
    expect(requestInsert).not.toHaveBeenCalled();
  });

  it('does not fail onboarding when the welcome message insert errors', async () => {
    messageInsert.mockResolvedValueOnce({ error: { message: 'boom' } });
    await expect(
      service.onboard('user-1', directoryDto),
    ).resolves.toMatchObject({ id: 'ch-1' });
  });

  describe('archetype custom-field seeding (#572)', () => {
    // The module-level archetype mock returns `customFields: []`, which is the
    // right default for the other tests (they assert nothing about fields).
    // These override it so the provisioning path has something to write.
    function seedFields(customFields: unknown[]) {
      (buildChapterConfigFromArchetype as jest.Mock).mockReturnValueOnce({
        archetype: 'nphc',
        modules: { chat: true },
        rolePack: 'test_pack',
        vocabulary: { recruitment: 'Rush', pledge: 'NM', class: 'Class' },
        customFields,
        workflows: [],
        dues: {},
      });
    }

    it('seeds the archetype default fields into chapter_custom_fields', async () => {
      seedFields([
        {
          id: 'cf_1',
          label: 'Major',
          type: 'text',
          required: true,
          visibleTo: 'chapter',
        },
        {
          id: 'cf_4',
          label: 'T-shirt size',
          type: 'select',
          required: false,
          visibleTo: 'chapter',
          options: ['XS', 'S'],
        },
      ]);

      await service.onboard('user-1', directoryDto);

      expect(fieldsUpsert).toHaveBeenCalledTimes(1);
      const [rows] = fieldsUpsert.mock.calls[0];
      expect(rows).toEqual([
        {
          chapter_id: 'ch-1',
          key: 'major',
          label: 'Major',
          type: 'text',
          required: true,
          visibility: 'chapter',
          sensitive: false,
          options: null,
          sort: 0,
        },
        {
          chapter_id: 'ch-1',
          key: 't_shirt_size',
          label: 'T-shirt size',
          type: 'select',
          required: false,
          visibility: 'chapter',
          sensitive: false,
          options: { choices: ['XS', 'S'] },
          sort: 1,
        },
      ]);
    });

    it('asks PostgREST to skip existing (chapter_id, key) rows', async () => {
      seedFields([
        {
          id: 'cf_1',
          label: 'Major',
          type: 'text',
          required: true,
          visibleTo: 'chapter',
        },
      ]);

      await service.onboard('user-1', directoryDto);

      // Named for what it asserts: the upsert options reaching the client. That
      // this yields true idempotency is a PostgREST/Postgres property of the
      // `unique (chapter_id, key)` constraint, which a mocked client cannot
      // demonstrate — only an integration test against a real DB could.
      const [, options] = fieldsUpsert.mock.calls[0];
      expect(options).toEqual({
        onConflict: 'chapter_id,key',
        ignoreDuplicates: true,
      });
    });

    it('writes nothing when the archetype seeds no fields', async () => {
      // The module-level mock already returns `customFields: []`.
      await service.onboard('user-1', directoryDto);
      expect(fieldsUpsert).not.toHaveBeenCalled();
    });

    it('logs at error level, and still onboards, when the seed insert fails', async () => {
      // Asserting only that onboard() resolves would pass even if the `error`
      // branch were deleted outright — the outer .catch() guarantees resolution
      // either way. The log is the only observable effect of that branch, so it
      // is what this pins. `error` not `warn`: onboarding still returns 201, so
      // a broken seed is invisible to the officer and fails for every chapter.
      const logged = jest
        .spyOn(service['logger'], 'error')
        .mockImplementation(() => undefined);
      seedFields([
        {
          id: 'cf_1',
          label: 'Major',
          type: 'text',
          required: true,
          visibleTo: 'chapter',
        },
      ]);
      fieldsUpsert.mockResolvedValueOnce({ error: { message: 'boom' } });

      await expect(
        service.onboard('user-1', directoryDto),
      ).resolves.toMatchObject({ id: 'ch-1' });

      expect(logged).toHaveBeenCalledWith(
        'chapter_custom_fields seed insert failed',
        { message: 'boom' },
      );
    });

    it('warns about — and does not seed — a malformed seed entry', async () => {
      // The `skipped` channel exists only to be logged. Without this assertion
      // the whole branch can be deleted and the suite stays green, so a field
      // silently missing from every new chapter would have no trace at all.
      const warned = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);
      seedFields([
        // A select with no choices: the CRUD contract rejects this shape, so
        // seeding it would create a row the Fields tab could never save again.
        {
          id: 'cf_4',
          label: 'Broken',
          type: 'select',
          required: false,
          visibleTo: 'chapter',
        },
        {
          id: 'cf_1',
          label: 'Major',
          type: 'text',
          required: true,
          visibleTo: 'chapter',
        },
      ]);

      await service.onboard('user-1', directoryDto);

      const [rows] = fieldsUpsert.mock.calls[0];
      expect(rows).toHaveLength(1);
      expect(rows[0].key).toBe('major');
      expect(warned).toHaveBeenCalledWith(expect.stringContaining('cf_4:'));
    });

    it('still creates the chapter when the field seed throws outright', async () => {
      seedFields([
        {
          id: 'cf_1',
          label: 'Major',
          type: 'text',
          required: true,
          visibleTo: 'chapter',
        },
      ]);
      const logged = jest
        .spyOn(service['logger'], 'error')
        .mockImplementation(() => undefined);
      fieldsUpsert.mockRejectedValueOnce(new Error('network down'));

      await expect(
        service.onboard('user-1', directoryDto),
      ).resolves.toMatchObject({ id: 'ch-1' });
      // The later best-effort writes must still run — a thrown seed must not
      // swallow the welcome message.
      expect(messageInsert).toHaveBeenCalled();
      // A rejection is the same every-chapter outage as a returned PostgREST
      // error, so it must log at the same level; asserting only that onboard()
      // resolves would pass at any level, or at none.
      expect(logged).toHaveBeenCalledWith(
        'Failed to provision archetype custom fields',
        expect.any(Error),
      );
    });
  });
});
