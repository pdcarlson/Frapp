import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { ChatReportController } from './chat-report.controller';
import {
  REPORT_QUEUE_PERMISSIONS,
  type ChatReportService,
} from '../../application/services/chat-report.service';
import { CHAT_REPORT_QUEUE_PERMISSIONS } from '@repo/validation';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { SystemPermissions } from '#domain/constants/permissions';

/**
 * The route-level half of the officer moderation surface (#2257, #2311).
 *
 * `PermissionsGuard` is what refuses a non-officer, and its own spec proves it
 * enforces whatever the metadata says. What can silently regress here is the
 * metadata itself: drop `@RequirePermissions(CHANNELS_MANAGE)` from the removal
 * route and any member holding `members:view` — which every seeded role does —
 * could remove any reported message, including one in a DM. So the decorators
 * are pinned, as `poll.controller.spec.ts` pins its own.
 *
 * Constructed with `new` rather than a testing module: nothing here runs a
 * guard, and the service is a double.
 */
describe('ChatReportController', () => {
  let controller: ChatReportController;
  let reportService: {
    removeReportedMessage: jest.Mock;
    listReports: jest.Mock;
    resolveReport: jest.Mock;
  };

  beforeEach(() => {
    reportService = {
      removeReportedMessage: jest.fn().mockResolvedValue({ id: 'report-1' }),
      listReports: jest.fn().mockResolvedValue([]),
      resolveReport: jest.fn().mockResolvedValue({ id: 'report-1' }),
    };
    controller = new ChatReportController(
      reportService as unknown as ChatReportService,
    );
  });

  const handlerPermissions = (handler: unknown): string[] =>
    Reflect.getMetadata(PERMISSIONS_KEY, handler as object) as string[];

  it('floors every route at members:view', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, ChatReportController)).toEqual([
      SystemPermissions.MEMBERS_VIEW,
    ]);
  });

  describe('POST :id/remove-message', () => {
    it('requires channels:manage on top of the class floor', () => {
      // The guard ANDs class and handler lists, so the route admits exactly
      // `members:view` + `channels:manage` (or `*`) — the officer queue's gate.
      expect(handlerPermissions(controller.removeReportedMessage)).toEqual([
        SystemPermissions.CHANNELS_MANAGE,
      ]);
    });

    it('answers 200, since it creates nothing', () => {
      expect(
        Reflect.getMetadata(
          HTTP_CODE_METADATA,
          controller.removeReportedMessage,
        ),
      ).toBe(200);
    });

    it('passes only the report id, the guard-resolved chapter and the caller', async () => {
      // No message id is accepted anywhere on this route: the report names the
      // message, so there is no second identifier to point at a sibling.
      const result = await controller.removeReportedMessage(
        'report-1',
        'chapter-1',
        'user-officer',
      );

      expect(reportService.removeReportedMessage).toHaveBeenCalledWith(
        'report-1',
        'chapter-1',
        'user-officer',
      );
      expect(result).toEqual({ id: 'report-1' });
    });
  });

  describe('the officer reads and writes act as the caller', () => {
    // The caller is what the repository excludes reports about: an officer who
    // is the reported sender must not see, resolve or act on that report. A
    // route that dropped `@CurrentUser` here would have no one to exclude.
    it('GET / passes the caller to the queue read', async () => {
      await controller.listReports('chapter-1', 'user-officer', {
        status: 'dismissed',
      });

      expect(reportService.listReports).toHaveBeenCalledWith(
        'chapter-1',
        'user-officer',
        'dismissed',
      );
    });

    it('PATCH :id passes the caller as the resolver', async () => {
      await controller.resolveReport('report-1', 'chapter-1', 'user-officer', {
        status: 'reviewed',
      });

      expect(reportService.resolveReport).toHaveBeenCalledWith(
        'report-1',
        'chapter-1',
        'reviewed',
        'user-officer',
      );
    });
  });

  it.each([
    ['GET /', 'listReports'],
    ['PATCH :id', 'resolveReport'],
    ['POST :id/remove-message', 'removeReportedMessage'],
  ] as const)(
    '%s requires exactly the shared queue permissions, class floor included',
    (_route, handler) => {
      // `CHAT_REPORT_QUEUE_PERMISSIONS` (`@repo/validation`) is the one
      // spelling of the union: the new-report notification addresses it and
      // the web queue gates on it. If a decorator changes, this fails until
      // the constant is brought back into line.
      const union = [
        ...(Reflect.getMetadata(
          PERMISSIONS_KEY,
          ChatReportController,
        ) as string[]),
        ...handlerPermissions(controller[handler]),
      ].sort();

      expect([...CHAT_REPORT_QUEUE_PERMISSIONS].sort()).toEqual(union);
    },
  );

  it('addresses the new-report notification to that same shared list', () => {
    expect(REPORT_QUEUE_PERMISSIONS).toBe(CHAT_REPORT_QUEUE_PERMISSIONS);
  });
});
