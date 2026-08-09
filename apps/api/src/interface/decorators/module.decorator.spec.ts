import { Reflector } from '@nestjs/core';
import { REQUIRED_MODULE_KEY, RequireModule } from './module.decorator';
import { EventController } from '../controllers/event.controller';
import { AttendanceController } from '../controllers/attendance.controller';
import { TaskController } from '../controllers/task.controller';
import { PointsController } from '../controllers/points.controller';
import { ServiceEntryController } from '../controllers/service-entry.controller';
import { PollController } from '../controllers/poll.controller';
import { BackworkController } from '../controllers/backwork.controller';
import { ChapterDocumentController } from '../controllers/chapter-document.controller';
import { ReportController } from '../controllers/report.controller';
import {
  StudyGeofenceController,
  StudySessionController,
} from '../controllers/study.controller';
import { ChatController } from '../controllers/chat.controller';
import { MemberController } from '../controllers/member.controller';
import { InviteController } from '../controllers/invite.controller';
import { BillingController } from '../controllers/billing.controller';
import { FinancialInvoiceController } from '../controllers/financial-invoice.controller';
import { AlumniController } from '../controllers/alumni.controller';

describe('RequireModule', () => {
  const reflector = new Reflector();
  const moduleOf = (target: object) =>
    reflector.get<string | undefined>(REQUIRED_MODULE_KEY, target);

  it('attaches the module key as route metadata', () => {
    @RequireModule('events')
    class Probe {}

    expect(moduleOf(Probe)).toBe('events');
  });

  it('leaves an undecorated class with no module metadata', () => {
    class Probe {}

    expect(moduleOf(Probe)).toBeUndefined();
  });

  // #264 acceptance criterion 3. The guard is inherited through ChapterGuard,
  // which every one of these controllers already uses — so the only way to
  // miss one is to forget the decorator. This table is that check.
  describe('paid-module controller coverage', () => {
    it.each([
      ['EventController', EventController, 'events'],
      ['AttendanceController', AttendanceController, 'events'],
      ['TaskController', TaskController, 'tasks'],
      ['PointsController', PointsController, 'points'],
      ['ServiceEntryController', ServiceEntryController, 'hours'],
      ['PollController', PollController, 'polls'],
      ['BackworkController', BackworkController, 'backwork'],
      ['ChapterDocumentController', ChapterDocumentController, 'documents'],
      ['ReportController', ReportController, 'reports'],
      ['StudyGeofenceController', StudyGeofenceController, 'geofences'],
      ['StudySessionController', StudySessionController, 'hours'],
    ])('%s gates on the %s module', (_name, controller, moduleKey) => {
      expect(moduleOf(controller)).toBe(moduleKey);
    });
  });

  // Gating any of these would break a documented guarantee, so the absence is
  // asserted rather than left to chance.
  describe('deliberately ungated controllers', () => {
    it.each([
      // Free always-on modules — not toggleable, so a gate would be dead code.
      ['ChatController', ChatController],
      ['MemberController', MemberController],
      ['InviteController', InviteController],
      // Subscription recovery paths: a chapter must be able to reach billing
      // and pay its invoices while locked. nav-config deliberately leaves
      // /billing ungated for the same reason.
      ['BillingController', BillingController],
      ['FinancialInvoiceController', FinancialInvoiceController],
      // members.alumni is a sub-feature of the free `members` module.
      ['AlumniController', AlumniController],
    ])('%s carries no module gate', (_name, controller) => {
      expect(moduleOf(controller)).toBeUndefined();
    });
  });
});
