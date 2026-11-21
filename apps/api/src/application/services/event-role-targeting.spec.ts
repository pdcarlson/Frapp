import { NotFoundException } from '@nestjs/common';
import type { EventAttendanceFields } from '@repo/validation';
import { SystemPermissions } from '#domain/constants/permissions';
import {
  filterVisibleEvents,
  isEventVisibleTo,
  isEventVisibleWith,
  visibleEventOrNotFound,
  type EventViewerLookups,
} from './event-role-targeting';

const OPEN: EventAttendanceFields & { id: string } = {
  id: 'open',
  others_invited: true,
};
const OFFICERS_ONLY: EventAttendanceFields & { id: string } = {
  id: 'officers',
  others_invited: false,
  required_role_ids: ['role-officer'],
};
const NOT_NEW_MEMBERS: EventAttendanceFields & { id: string } = {
  id: 'not-new',
  others_invited: true,
  excluded_role_ids: ['role-new'],
};
const EVENTS = [OPEN, OFFICERS_ONLY, NOT_NEW_MEMBERS];

function lookups(opts: {
  manages?: boolean;
  member?: { role_ids: string[] } | null;
}): EventViewerLookups & {
  rbac: { memberHasAnyPermission: jest.Mock };
  memberRepo: { findByUserAndChapter: jest.Mock };
} {
  return {
    rbac: {
      memberHasAnyPermission: jest.fn().mockResolvedValue(!!opts.manages),
    },
    memberRepo: {
      findByUserAndChapter: jest
        .fn()
        .mockResolvedValue(opts.member === undefined ? null : opts.member),
    },
  };
}

describe('event read gate', () => {
  describe('isEventVisibleWith', () => {
    it('shows an event that invites everyone to anyone', () => {
      expect(
        isEventVisibleWith(OPEN, { permissions: new Set(), role_ids: [] }),
      ).toBe(true);
    });

    it.each(['*', SystemPermissions.EVENTS_UPDATE])(
      'shows a limited event to a holder of %s',
      (permission) => {
        expect(
          isEventVisibleWith(OFFICERS_ONLY, {
            permissions: new Set([permission]),
            role_ids: [],
          }),
        ).toBe(true);
      },
    );

    it('shows a limited event only to the members it invites', () => {
      const none = new Set<string>();
      expect(
        isEventVisibleWith(OFFICERS_ONLY, {
          permissions: none,
          role_ids: ['role-officer'],
        }),
      ).toBe(true);
      expect(
        isEventVisibleWith(OFFICERS_ONLY, { permissions: none, role_ids: [] }),
      ).toBe(false);
      expect(
        isEventVisibleWith(NOT_NEW_MEMBERS, {
          permissions: none,
          role_ids: ['role-new'],
        }),
      ).toBe(false);
    });
  });

  describe('isEventVisibleTo', () => {
    it('reads nothing for an event that invites everyone', async () => {
      const deps = lookups({});
      await expect(isEventVisibleTo(OPEN, 'c1', 'u1', deps)).resolves.toBe(
        true,
      );
      expect(deps.rbac.memberHasAnyPermission).not.toHaveBeenCalled();
      expect(deps.memberRepo.findByUserAndChapter).not.toHaveBeenCalled();
    });

    it('asks for events:update and skips the member read when held', async () => {
      const deps = lookups({ manages: true });
      await expect(
        isEventVisibleTo(OFFICERS_ONLY, 'c1', 'u1', deps),
      ).resolves.toBe(true);
      expect(deps.rbac.memberHasAnyPermission).toHaveBeenCalledWith(
        'c1',
        'u1',
        [SystemPermissions.EVENTS_UPDATE],
      );
      expect(deps.memberRepo.findByUserAndChapter).not.toHaveBeenCalled();
    });

    it('answers by the member roles otherwise', async () => {
      const officer = lookups({ member: { role_ids: ['role-officer'] } });
      await expect(
        isEventVisibleTo(OFFICERS_ONLY, 'c1', 'u1', officer),
      ).resolves.toBe(true);
      expect(officer.memberRepo.findByUserAndChapter).toHaveBeenCalledWith(
        'u1',
        'c1',
      );
      await expect(
        isEventVisibleTo(
          OFFICERS_ONLY,
          'c1',
          'u1',
          lookups({ member: { role_ids: [] } }),
        ),
      ).resolves.toBe(false);
    });

    it('shows a non-member no limited event, even one whose default invites', async () => {
      await expect(
        isEventVisibleTo(
          NOT_NEW_MEMBERS,
          'c1',
          'u1',
          lookups({ member: null }),
        ),
      ).resolves.toBe(false);
    });
  });

  describe('filterVisibleEvents', () => {
    it('reads nothing when no event limits its audience', async () => {
      const deps = lookups({});
      const events = [OPEN];
      await expect(filterVisibleEvents(events, 'c1', 'u1', deps)).resolves.toBe(
        events,
      );
      expect(deps.rbac.memberHasAnyPermission).not.toHaveBeenCalled();
      expect(deps.memberRepo.findByUserAndChapter).not.toHaveBeenCalled();
    });

    it('reads the permission and the member row once for the whole list', async () => {
      const deps = lookups({ member: { role_ids: ['role-new'] } });
      const visible = await filterVisibleEvents(EVENTS, 'c1', 'u1', deps);
      expect(visible.map((e) => e.id)).toEqual(['open']);
      expect(deps.rbac.memberHasAnyPermission).toHaveBeenCalledTimes(1);
      expect(deps.memberRepo.findByUserAndChapter).toHaveBeenCalledTimes(1);
    });

    it('keeps every event for a holder of events:update', async () => {
      const deps = lookups({ manages: true });
      const visible = await filterVisibleEvents(EVENTS, 'c1', 'u1', deps);
      expect(visible).toEqual(EVENTS);
      expect(deps.memberRepo.findByUserAndChapter).not.toHaveBeenCalled();
    });

    it('reads a caller with no member row as holding no roles', async () => {
      const visible = await filterVisibleEvents(
        EVENTS,
        'c1',
        'u1',
        lookups({ member: null }),
      );
      expect(visible.map((e) => e.id)).toEqual(['open', 'not-new']);
    });

    // The list and the detail route answer one rule: for every member, the
    // batch keeps exactly the events the single-event form shows them.
    it.each([
      { manages: true, member: { role_ids: [] } },
      { member: { role_ids: ['role-officer'] } },
      { member: { role_ids: ['role-new'] } },
      { member: { role_ids: [] } },
    ])('agrees with isEventVisibleTo for %j', async (viewer) => {
      const batch = await filterVisibleEvents(
        EVENTS,
        'c1',
        'u1',
        lookups(viewer),
      );
      const single: string[] = [];
      for (const event of EVENTS) {
        if (await isEventVisibleTo(event, 'c1', 'u1', lookups(viewer))) {
          single.push(event.id);
        }
      }
      expect(batch.map((e) => e.id)).toEqual(single);
    });
  });

  describe('visibleEventOrNotFound', () => {
    it('returns an event the caller may see', async () => {
      await expect(
        visibleEventOrNotFound(OPEN, 'c1', 'u1', lookups({})),
      ).resolves.toBe(OPEN);
    });

    it('404s a missing event and a hidden one alike', async () => {
      for (const event of [null, OFFICERS_ONLY]) {
        await expect(
          visibleEventOrNotFound(
            event,
            'c1',
            'u1',
            lookups({ member: { role_ids: [] } }),
          ),
        ).rejects.toThrow(new NotFoundException('Event not found'));
      }
    });
  });
});
