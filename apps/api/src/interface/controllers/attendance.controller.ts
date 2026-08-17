import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AttendanceService } from '../../application/services/attendance.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { RequireModule } from '../decorators/module.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { CheckInDto, UpdateAttendanceDto } from '../dtos/attendance.dto';
import { SystemPermissions } from '../../domain/constants/permissions';

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
      'Accepts a bare body (plain self check-in, e.g. the chat event card), a rotating `token` scanned from the host QR, or a typed `manualCode`. `lat`/`lng` are required when the event defines a check-in geofence.',
  })
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
    });
  }

  // GET, not POST: minting writes nothing — the code is derived from the event
  // id, the clock, and the signing secret. Beyond being the honest verb, it
  // keeps the host screen's ~6 requests/minute of polling on the read throttle
  // bucket (100/60s) instead of the write bucket (30/60s), which an officer
  // running check-in also needs for everything else they are doing.
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
  async markAutoAbsent(
    @Param('eventId') eventId: string,
    @CurrentChapterId() chapterId: string,
  ) {
    return this.attendanceService.markAutoAbsent(eventId, chapterId);
  }
}
