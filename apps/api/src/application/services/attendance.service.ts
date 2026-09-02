import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ATTENDANCE_REPOSITORY } from '../../domain/repositories/attendance.repository.interface';
import type { IAttendanceRepository } from '../../domain/repositories/attendance.repository.interface';
import { EVENT_REPOSITORY } from '../../domain/repositories/event.repository.interface';
import type { IEventRepository } from '../../domain/repositories/event.repository.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import type { EventAttendance } from '../../domain/entities/event-attendance.entity';
import { RbacService } from './rbac.service';
import { isValidZone, pointInPolygon } from '../../domain/utils/geofence';
import {
  mintCheckInToken,
  verifyCheckInToken,
  verifyManualCode,
  type MintedCheckInToken,
} from '../../domain/utils/check-in-token';

/**
 * Grace period after `end_time` during which check-in stays open and before
 * which auto-absent must not run (`spec/behavior/events.md`). Exported so the
 * scheduled auto-absent sweep computes the same cutoff this service enforces,
 * rather than keeping a second copy that could drift.
 */
export const CHECK_IN_GRACE_PERIOD_MINUTES = 15;

/**
 * Optional, like `ANALYTICS_HMAC_SALT`: absent, the rotating-token feature is
 * simply unavailable (mint returns 503, a supplied token is rejected) and plain
 * self check-in is unaffected — so local dev, tests and CI boot without it.
 * Provisioned per environment in Infisical; see `ENV_REFERENCE.md`.
 */
const CHECK_IN_TOKEN_SECRET_VAR = 'EVENT_CHECK_IN_TOKEN_SECRET';

/** What the scanner (s18) may send alongside a self check-in. */
export interface CheckInOptions {
  token?: string;
  manualCode?: string;
  lat?: number;
  lng?: number;
}

@Injectable()
export class AttendanceService {
  constructor(
    @Inject(ATTENDANCE_REPOSITORY)
    private readonly attendanceRepo: IAttendanceRepository,
    @Inject(EVENT_REPOSITORY)
    private readonly eventRepo: IEventRepository,
    @Inject(MEMBER_REPOSITORY)
    private readonly memberRepo: IMemberRepository,
    private readonly rbac: RbacService,
  ) {}

  /**
   * Mint the rotating code the host screen (s22) displays.
   *
   * Officer-gated at the controller (`events:update`), matching the attendance
   * roster read on the same controller — the code is what lets people into the
   * attendance record, so minting it is an officer capability.
   */
  async mintCheckInToken(
    eventId: string,
    chapterId: string,
  ): Promise<MintedCheckInToken> {
    const event = await this.eventRepo.findById(eventId, chapterId);
    if (!event) {
      throw new NotFoundException('Event not found');
    }

    return mintCheckInToken(eventId, this.requireTokenSecret(), Date.now());
  }

  /**
   * A 503 rather than a silent fallback: with no secret there is no way to mint
   * a code, and pretending otherwise would put an un-scannable screen in front
   * of an officer with no explanation.
   */
  private requireTokenSecret(): string {
    const secret = process.env[CHECK_IN_TOKEN_SECRET_VAR];
    if (!secret) {
      throw new ServiceUnavailableException(
        'Rotating check-in codes are not configured for this environment',
      );
    }
    return secret;
  }

  async checkIn(
    eventId: string,
    userId: string,
    chapterId: string,
    options: CheckInOptions = {},
  ): Promise<EventAttendance> {
    const event = await this.eventRepo.findById(eventId, chapterId);
    if (!event) {
      throw new NotFoundException('Event not found');
    }

    const now = new Date();
    const start = new Date(event.start_time);
    const end = new Date(event.end_time);
    const graceWindowEnd = new Date(
      end.getTime() + CHECK_IN_GRACE_PERIOD_MINUTES * 60 * 1000,
    );

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Event times are invalid');
    }

    if (now < start || now > graceWindowEnd) {
      throw new BadRequestException(
        'Check-in is only allowed during the event time window',
      );
    }

    // Window first, deliberately. Ordering only changes *which* error a caller
    // sees when more than one check fails, and "check-in has closed" is the
    // actionable answer for the common case (a member scanning after the grace
    // period). Nothing writes before `checkInAtomic` below, so no ordering here
    // risks partial work. The window is not secret either — every member can
    // read event times from `GET /v1/events` — so leading with it leaks nothing.

    // ── Rotating token ──────────────────────────────────────────────────
    //
    // Verified when supplied; never required. That is the spec's design, not an
    // oversight: `spec/ui/mobile/patterns.md` is explicit that "the rotating
    // code raises effort; the geofence enforces presence", and
    // `spec/behavior/events.md` keeps the chat event card as an additional
    // self-service check-in surface, which posts no token at all.
    //
    // The consequence is worth stating plainly: a caller who simply omits
    // `token` skips this check, so the token is an assurance signal (it catches
    // a forwarded screenshot or a stale code), not an access control. The
    // geofence below is the control. Making the token mandatory needs a
    // per-event opt-in flag — filed as follow-up work rather than invented here.
    if (options.token !== undefined || options.manualCode !== undefined) {
      const secret = this.requireTokenSecret();
      const accepted =
        (options.token !== undefined &&
          verifyCheckInToken(options.token, eventId, secret, now.getTime())) ||
        (options.manualCode !== undefined &&
          verifyManualCode(options.manualCode, eventId, secret, now.getTime()));

      if (!accepted) {
        throw new ForbiddenException(
          'That check-in code is not valid for this event, or it has expired',
        );
      }
    }

    // ── Geofence ────────────────────────────────────────────────────────
    //
    // The anti-proxy control (`patterns.md`): any displayed code can be
    // screenshotted and forwarded, so presence is what the server actually
    // verifies. Enforced on every surface, regardless of whether a token came
    // with the request.
    if (event.check_in_zone !== null && event.check_in_zone !== undefined) {
      // A malformed zone is a hard failure, never "no zone". Falling through
      // would silently disable the check the row exists to encode — the exact
      // failure mode a geofence must not have.
      if (!isValidZone(event.check_in_zone)) {
        throw new BadRequestException(
          'This event has an invalid check-in area; an officer needs to redraw it',
        );
      }

      // Destructured and checked with `typeof`, which genuinely narrows to
      // `number` — `Number.isFinite` returns a plain boolean, so testing it
      // alone would leave the values `number | undefined` and force casts at
      // the call below. Both checks are needed: `typeof` rejects a missing
      // coordinate, `isFinite` rejects NaN and Infinity.
      const { lat, lng } = options;
      if (
        typeof lat !== 'number' ||
        typeof lng !== 'number' ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
      ) {
        // Names the surface, because the caller that hits this is usually the
        // web chat event card, which structurally cannot send a location. The
        // card renders the server's message verbatim through `getErrorMessage`,
        // so putting the guidance here is what makes that path honest — and it
        // costs no per-card fetch of the event just to learn it has a zone.
        throw new BadRequestException(
          'This event checks you in by location — use the Frapp mobile app to check in.',
        );
      }

      if (!pointInPolygon(lat, lng, event.check_in_zone)) {
        throw new ForbiddenException('You need to be at the event to check in');
      }
    }

    // If the event targets specific roles, only members with matching roles can check in.
    const isRoleTargeted = Boolean(event.required_role_ids?.length);
    if (isRoleTargeted) {
      const member = await this.memberRepo.findByUserAndChapter(
        userId,
        chapterId,
      );
      if (!member) {
        throw new ForbiddenException('You are not a member of this chapter');
      }

      const hasRequiredRole = event.required_role_ids!.some((roleId) =>
        member.role_ids.includes(roleId),
      );
      if (!hasRequiredRole) {
        throw new ForbiddenException(
          'You are not eligible to check in for this event',
        );
      }
    }

    // Alumni do not check in to events or accrue attendance points
    // (`spec/behavior/alumni.md`), and the route carries no permission
    // requirement, so the lifecycle rule is enforced here. A role-targeted
    // event is an explicit chapter decision about who attends — an
    // alumni-facing event (homecoming) lists the Alumni role in
    // `required_role_ids`, and the check above already proved the caller
    // matches — so the lifecycle rule does not override it.
    if (!isRoleTargeted && (await this.rbac.isAlumni(chapterId, userId))) {
      throw new ForbiddenException(
        'Alumni members cannot check in to chapter events',
      );
    }

    const existing = await this.attendanceRepo.findByEventAndUser(
      eventId,
      userId,
    );
    if (existing) {
      throw new ConflictException('Already checked in for this event');
    }

    const checkInTime = now.toISOString();

    // Insert the attendance row and award the event's ATTENDANCE points
    // atomically in one DB transaction, so a partial failure can't leave points
    // without attendance (or attendance without points). The unique
    // (event_id, user_id) index -- enforced inside the RPC via
    // `on conflict do nothing` -- is the authoritative guard against a concurrent
    // double check-in; the duplicate read above is only a friendly fast path. A
    // lost race (the row already exists) returns null, which maps to the same
    // 409 as the fast-path guard.
    const attendance = await this.attendanceRepo.checkInAtomic(
      eventId,
      userId,
      event.chapter_id,
      checkInTime,
      event.point_value,
      event.name,
    );
    if (!attendance) {
      throw new ConflictException('Already checked in for this event');
    }

    return attendance;
  }

  async getAttendance(
    eventId: string,
    chapterId: string,
  ): Promise<EventAttendance[]> {
    const event = await this.eventRepo.findById(eventId, chapterId);
    if (!event) {
      throw new NotFoundException('Event not found');
    }

    return this.attendanceRepo.findByEvent(eventId);
  }

  async updateStatus(
    eventId: string,
    userId: string,
    chapterId: string,
    status: EventAttendance['status'],
    excuseReason: string | null,
    markedBy: string,
  ): Promise<EventAttendance> {
    const event = await this.eventRepo.findById(eventId, chapterId);
    if (!event) {
      throw new NotFoundException('Event not found');
    }

    const attendance = await this.attendanceRepo.findByEventAndUser(
      eventId,
      userId,
    );
    if (!attendance) {
      throw new NotFoundException('Attendance record not found');
    }

    return this.attendanceRepo.update(attendance.id, {
      status,
      excuse_reason: excuseReason,
      marked_by: markedBy,
    });
  }

  /**
   * The members an event actually applies to.
   *
   * Exported (rather than inlined into `markAutoAbsent`) because the pre-event
   * reminder sweep must address exactly this audience and no other. A second,
   * independently-written copy of this rule is the failure mode worth
   * preventing: a reminder that resolved role targeting even slightly
   * differently would push a role-targeted event's name to members who cannot
   * see that event through `GET /v1/events` at all.
   *
   * - **Role-targeted** (`required_role_ids` non-empty) → members holding an
   *   intersecting role, alumni included. Targeting names its audience
   *   explicitly, so nothing is subtracted from it.
   * - **Mandatory, untargeted** → every member except alumni. Alumni cannot
   *   check in to a non-targeted event and cannot self-excuse, so including
   *   them would hand every alumnus a guaranteed ABSENT record on every
   *   mandatory event.
   * - **Neither** → `[]`. An optional, untargeted event requires nothing of
   *   anyone, so it has no required audience.
   *
   * Note `required_role_ids` is stored as a non-null empty array when cleared,
   * so emptiness — not nullness — is the test.
   */
  async resolveRequiredMembers(
    chapterId: string,
    event: { is_mandatory: boolean; required_role_ids?: string[] | null },
  ): Promise<Awaited<ReturnType<IMemberRepository['findByChapter']>>> {
    const isRoleTargeted = (event.required_role_ids?.length ?? 0) > 0;
    if (!event.is_mandatory && !isRoleTargeted) return [];

    const allMembers = await this.memberRepo.findByChapter(chapterId);

    if (isRoleTargeted) {
      const requiredRoleIdSet = new Set(event.required_role_ids!);
      return allMembers.filter((m) =>
        m.role_ids.some((roleId) => requiredRoleIdSet.has(roleId)),
      );
    }

    const alumniRoleId = await this.rbac.getAlumniRoleId(chapterId);
    return alumniRoleId
      ? allMembers.filter((m) => !m.role_ids.includes(alumniRoleId))
      : allMembers;
  }

  async markAutoAbsent(
    eventId: string,
    chapterId: string,
  ): Promise<{ marked: number }> {
    const event = await this.eventRepo.findById(eventId, chapterId);
    if (!event) {
      throw new NotFoundException('Event not found');
    }

    const end = new Date(event.end_time);
    const graceEnd = new Date(
      end.getTime() + CHECK_IN_GRACE_PERIOD_MINUTES * 60 * 1000,
    );
    if (new Date() < graceEnd) {
      throw new BadRequestException(
        'Cannot mark auto-absent before the grace period ends',
      );
    }

    const requiredMembers = await this.resolveRequiredMembers(chapterId, event);
    if (requiredMembers.length === 0) {
      return { marked: 0 };
    }

    const existingRecords = await this.attendanceRepo.findByEvent(eventId);
    const checkedInOrExcused = new Set(
      existingRecords
        .filter(
          (r) =>
            r.status === 'PRESENT' ||
            r.status === 'EXCUSED' ||
            r.status === 'LATE',
        )
        .map((r) => r.user_id),
    );
    const usersWithAttendanceRecords = new Set(
      existingRecords.map((r) => r.user_id),
    );

    const membersToMark = requiredMembers.filter((member) => {
      const isCheckedInOrExcused = checkedInOrExcused.has(member.user_id);
      const hasExistingRecord = usersWithAttendanceRecords.has(member.user_id);
      return !isCheckedInOrExcused && !hasExistingRecord;
    });

    if (membersToMark.length === 0) {
      return { marked: 0 };
    }

    const rows = membersToMark.map((member) => ({
      event_id: eventId,
      user_id: member.user_id,
      status: 'ABSENT' as const,
      check_in_time: null,
      excuse_reason: null,
      marked_by: null,
    }));

    const created = await this.attendanceRepo.createMany(rows);

    return { marked: created.length };
  }
}
