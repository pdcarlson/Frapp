import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AttendanceService } from '../../application/services/attendance.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { RequireModule } from '../decorators/module.decorator';
import {
  FeatureEvent,
  type FeatureEventInput,
  hasText,
} from '../decorators/feature-event.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import {
  AutoAbsentResultDto,
  CheckInDto,
  CheckInScreenDto,
  CheckInScreenResultDto,
  MyAttendanceDto,
  UpdateAttendanceDto,
} from '../dtos/attendance.dto';
import { SystemPermissions } from '#domain/constants/permissions';

/**
 * How a check-in was made, from the credential the request carried. The
 * service admits a request on either credential when it carries both, so that
 * case is its own value rather than a guess. A credential counts when it could
 * have admitted the request, which is what `hasText` reads from the raw body:
 * implicit conversion turns a number into the string the DTO wants (an
 * all-digit manual code verifies), while a blank or `null` one never verifies.
 */
function checkInMethod(
  body: CheckInDto | undefined,
): 'qr' | 'manual_code' | 'plain' | 'qr_or_manual_code' {
  const token = hasText(body?.token);
  const manualCode = hasText(body?.manualCode);
  if (token && manualCode) return 'qr_or_manual_code';
  if (token) return 'qr';
  return manualCode ? 'manual_code' : 'plain';
}

@ApiTags('Attendance')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard)
@RequireModule('events')
@Controller('events/:eventId/attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post('check-in')
  @ApiOperation({
    summary: 'Self check-in to an event',
    description:
      "Accepts a bare body (plain self check-in, e.g. the chat event card), a rotating `token` scanned from the host QR, or a typed `manualCode`. Once an officer's screen has shown the code for the event, a code is required. `lat`/`lng` are required when the event defines a check-in geofence, or when the screen showing the code reported where it is; then the member must be within 100 yards of it.",
  })
  // The body is optional (a bare plain check-in), so it may be absent.
  @FeatureEvent(
    'attendance-checked-in',
    ({ body }: FeatureEventInput<CheckInDto | undefined>) => ({
      method: checkInMethod(body),
      has_location: body?.lat != null && body?.lng != null,
    }),
  )
  async checkIn(
    @Param('eventId') eventId: string,
    @CurrentUser('id') userId: string,
    @CurrentChapterId() chapterId: string,
    @Body() dto: CheckInDto,
  ) {
    return this.attendanceService.checkIn(eventId, userId, chapterId, {
      token: dto.token,
      manualCode: dto.manualCode,
      lat: dto.lat,
      lng: dto.lng,
      accuracyMeters: dto.accuracy_meters,
    });
  }

  // PUT: it replaces the event's one screen record, and repeating it changes
  // nothing more. About once a minute while the host screen is up, so it sits
  // well inside the write throttle an officer also needs for everything else.
  @Put('check-in-screen')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.EVENTS_UPDATE)
  @ApiOperation({
    summary: 'Report where the host check-in screen (s22) is',
    description:
      "Sent while an officer's screen shows the rotating code. Marks the code as in use, which makes it required for the rest of the check-in window, and stores the screen's location (when precise to 100 m and the event has no drawn zone) so members must check in within 100 yards of it. Stored only inside the check-in window and deleted after it closes. Officer-only, like the mint.",
  })
  @ApiOkResponse({ type: CheckInScreenResultDto })
  async reportCheckInScreen(
    @Param('eventId') eventId: string,
    @CurrentChapterId() chapterId: string,
    @Body() dto: CheckInScreenDto,
  ): Promise<CheckInScreenResultDto> {
    return this.attendanceService.reportCheckInScreen(eventId, chapterId, {
      lat: dto.lat,
      lng: dto.lng,
      accuracyMeters: dto.accuracy_meters,
    });
  }

  // GET, not POST: minting writes nothing — the code is derived from the event
  // id, the clock, and the signing secret. Beyond being the honest verb, it
  // keeps the host screen's requests on the read throttle bucket (100/60s)
  // instead of the write bucket (30/60s), which an officer running check-in
  // also needs for everything else they are doing. The screen asks about once
  // per 30s rotation, again each time it regains focus, and every 10s only
  // while a request is failing in a way that may clear (`useMintCheckInToken`
  // in `@repo/hooks`).
  @Get('check-in-token')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.EVENTS_UPDATE)
  @ApiOperation({
    summary: 'Mint the rotating check-in code for the host display (s22)',
    description:
      'Returns the current 30-second token, its QR payload, and the short manual code. Officer-only: the code is what admits members to the attendance record. Returns 503 when the environment has no signing secret configured.',
  })
  async mintCheckInToken(
    @Param('eventId') eventId: string,
    @CurrentChapterId() chapterId: string,
  ) {
    return this.attendanceService.mintCheckInToken(eventId, chapterId);
  }

  // Declared before `@Get()`'s siblings take a path param, and a literal
  // segment, so it never reads as a user id. It is the caller's own row, so
  // it needs no `events:update` (unlike the roster below), but it does need
  // `members:view`, the gate `GET /v1/events/:id` carries on its whole
  // controller: answering here for an event that route refuses would tell a
  // member without it which event ids exist.
  @Get('me')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.MEMBERS_VIEW)
  @ApiOperation({
    summary: "The caller's own attendance for an event",
    description:
      "Lets a member's event page show that they are checked in (and when) instead of offering check-in again. `attendance` is null when they have no row.",
  })
  @ApiOkResponse({ type: MyAttendanceDto })
  async mine(
    @Param('eventId') eventId: string,
    @CurrentUser('id') userId: string,
    @CurrentChapterId() chapterId: string,
  ): Promise<MyAttendanceDto> {
    return {
      attendance: await this.attendanceService.getMyAttendance(
        eventId,
        userId,
        chapterId,
      ),
    };
  }

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.EVENTS_UPDATE)
  @ApiOperation({ summary: 'List attendance for an event' })
  async list(
    @Param('eventId') eventId: string,
    @CurrentChapterId() chapterId: string,
  ) {
    return this.attendanceService.getAttendance(eventId, chapterId);
  }

  @Patch(':userId')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.EVENTS_UPDATE)
  @ApiOperation({ summary: 'Update attendance status for a member' })
  @FeatureEvent(
    'attendance-marked',
    ({ body }: FeatureEventInput<UpdateAttendanceDto>) => ({
      status: body.status,
      has_excuse: hasText(body.excuse_reason),
    }),
  )
  async updateStatus(
    @Param('eventId') eventId: string,
    @Param('userId') userId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') adminId: string,
    @Body() dto: UpdateAttendanceDto,
  ) {
    return this.attendanceService.updateStatus(
      eventId,
      userId,
      chapterId,
      dto.status,
      dto.excuse_reason ?? null,
      adminId,
    );
  }

  @Post('auto-absent')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.EVENTS_UPDATE)
  @ApiOperation({ summary: 'Trigger auto-absent marking for an event' })
  @ApiCreatedResponse({ type: AutoAbsentResultDto })
  async markAutoAbsent(
    @Param('eventId') eventId: string,
    @CurrentChapterId() chapterId: string,
  ): Promise<AutoAbsentResultDto> {
    return this.attendanceService.markAutoAbsent(eventId, chapterId);
  }
}
