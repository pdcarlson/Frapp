// ChapterController + ChapterConfigController pull in services that import the
// ESM-only @repo packages. Mock them so the module graph loads under jest.
jest.mock('@repo/org-archetypes', () => ({
  buildChapterConfigFromArchetype: jest.fn(() => ({
    archetype: 'ifc',
    modules: {},
    rolePack: 'ifc_standard',
    vocabulary: {},
    customFields: [],
    workflows: [],
    dues: {},
  })),
  getArchetype: jest.fn((key: string) => ({ key })),
}));
jest.mock('@repo/chapter-theme', () => ({
  // Mirrors the real DeriveSignetPaletteResult shape. `buildChapterPalette`
  // reads `invalidSeed` and iterates `contrastChecks`, so a partial double
  // would throw if any test here ever reached the palette path.
  deriveSignetPalette: jest.fn(() => ({
    palette: {},
    resolvedSeed: '#F2B72E',
    invalidSeed: false,
    contrastChecks: [],
  })),
}));

import { Reflector } from '@nestjs/core';
import {
  SUBSCRIPTION_EXEMPT_KEY,
  SUBSCRIPTION_FREE_TIER_KEY,
} from './subscription.decorator';
import { ChatController } from '../controllers/chat.controller';
import { MemberController } from '../controllers/member.controller';
import { InviteController } from '../controllers/invite.controller';
import { RbacController } from '../controllers/rbac.controller';
import { ChapterConfigController } from '../controllers/chapter-config.controller';
import { UserController } from '../controllers/user.controller';
import { SearchController } from '../controllers/search.controller';
import { ChapterController } from '../controllers/chapter.controller';
import { BillingController } from '../controllers/billing.controller';
import { EventController } from '../controllers/event.controller';
import { TaskController } from '../controllers/task.controller';
import { PollController } from '../controllers/poll.controller';
import { ServiceEntryController } from '../controllers/service-entry.controller';
import { FinancialInvoiceController } from '../controllers/financial-invoice.controller';
import { AttendanceController } from '../controllers/attendance.controller';
import { BackworkController } from '../controllers/backwork.controller';
import { PointsController } from '../controllers/points.controller';
import { ChapterDocumentController } from '../controllers/chapter-document.controller';
import {
  StudyGeofenceController,
  StudySessionController,
} from '../controllers/study.controller';
import { ReportController } from '../controllers/report.controller';
import { AlumniController } from '../controllers/alumni.controller';
import { SemesterRolloverController } from '../controllers/semester-rollover.controller';

describe('subscription decorator wiring', () => {
  const reflector = new Reflector();

  const freeTier = [
    ChatController,
    MemberController,
    InviteController,
    RbacController,
    ChapterConfigController,
    UserController,
    SearchController,
    ChapterController,
  ];

  const exempt = [BillingController];

  const paidOps = [
    EventController,
    TaskController,
    PollController,
    ServiceEntryController,
    FinancialInvoiceController,
    AttendanceController,
    BackworkController,
    PointsController,
    ChapterDocumentController,
    StudyGeofenceController,
    StudySessionController,
    ReportController,
    AlumniController,
    SemesterRolloverController,
  ];

  it.each(freeTier)('%p is marked @FreeTier', (controller) => {
    expect(reflector.get(SUBSCRIPTION_FREE_TIER_KEY, controller)).toBe(true);
    expect(reflector.get(SUBSCRIPTION_EXEMPT_KEY, controller)).toBeUndefined();
  });

  it.each(exempt)('%p is marked @SubscriptionExempt', (controller) => {
    expect(reflector.get(SUBSCRIPTION_EXEMPT_KEY, controller)).toBe(true);
    expect(
      reflector.get(SUBSCRIPTION_FREE_TIER_KEY, controller),
    ).toBeUndefined();
  });

  it.each(paidOps)('%p is paid-ops (unmarked)', (controller) => {
    expect(
      reflector.get(SUBSCRIPTION_FREE_TIER_KEY, controller),
    ).toBeUndefined();
    expect(reflector.get(SUBSCRIPTION_EXEMPT_KEY, controller)).toBeUndefined();
  });
});
