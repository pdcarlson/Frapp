// The shared @repo packages ship ESM-only dist (type: module) and the API's
// jest setup doesn't transform them. Mock the two pure helpers — their seed /
// palette logic is covered by each package's own tests; here we exercise the
// onboarding orchestration only.
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
  // Mirrors the real DerivePaletteResult shape. Returning a partial object here
  // hid a live defect once: the service read `result.invalidInputs` unguarded,
  // threw, and the surrounding try/catch turned that into a silently missing
  // theme_palette. Keep this in step with packages/chapter-theme.
  derivePalette: jest.fn(() => ({
    palette: { '--side-bg': '#1F1A15' },
    fallbacks: {},
    invalidInputs: {},
    resolvedDark: '#1F1A15',
    resolvedAccent: '#7A5A2F',
  })),
}));
jest.mock('@repo/validation', () => ({ LEGAL_POLICY_VERSION: 'test-version' }));

import { Test, TestingModule } from '@nestjs/testing';
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
    from = jest.fn((table: string) => {
      if (table === 'chat_channels') return channelQuery;
      if (table === 'chat_messages') return { insert: messageInsert };
      if (table === 'chapter_directory_requests')
        return { insert: requestInsert };
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
      colors: { dark: '#4B0082', accent: '#C9A56F' },
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
      colors: { dark: '#4B0082', accent: '#C9A56F' },
    });
    // A derived theme palette is persisted when colors are supplied.
    expect(payload.config.theme_palette).toBeDefined();
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
});
