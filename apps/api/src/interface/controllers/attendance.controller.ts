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
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { CheckInDto, UpdateAttendanceDto } from '../dtos/attendance.dto';
import { SystemPermissions } from '../../domain/constants/permissions';

@ApiTags('Attendance')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard)
@Controller('events/:eventId/attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post('check-in')
  @ApiOperation({ summary: 'Self check-in to an event' })
  async checkIn(
    @Param('eventId') eventId: string,
    @CurrentUser('id') userId: string,
    @CurrentChapterId() chapterId: string,
    @Body() _dto: CheckInDto,
  ) {
    return this.attendanceService.checkIn(eventId, userId, chapterId);
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
}
