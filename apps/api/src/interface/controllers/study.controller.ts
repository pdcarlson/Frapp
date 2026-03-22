import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StudyService } from '../../application/services/study.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import {
  CreateGeofenceDto,
  UpdateGeofenceDto,
  StartStudySessionDto,
  StudySessionHeartbeatDto,
} from '../dtos/study.dto';
import { SystemPermissions } from '../../domain/constants/permissions';

@ApiTags('Study Hours')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@Controller('geofences')
export class StudyGeofenceController {
  constructor(private readonly studyService: StudyService) {}

  @Get()
  @ApiOperation({ summary: 'List chapter geofences' })
  async list(@CurrentChapterId() chapterId: string) {
    return this.studyService.listGeofences(chapterId);
  }

  @Post()
  @RequirePermissions(SystemPermissions.GEOFENCES_MANAGE)
  @ApiOperation({ summary: 'Create geofence (admin)' })
  async create(
    @CurrentChapterId() chapterId: string,
    @Body() dto: CreateGeofenceDto,
  ) {
    return this.studyService.createGeofence(chapterId, {
      name: dto.name,
      coordinates: dto.coordinates,
      is_active: dto.is_active,
      minutes_per_point: dto.minutes_per_point,
      points_per_interval: dto.points_per_interval,
      min_session_minutes: dto.min_session_minutes,
    });
  }

  @Patch(':id')
  @RequirePermissions(SystemPermissions.GEOFENCES_MANAGE)
  @ApiOperation({ summary: 'Update geofence (admin)' })
  async update(
    @CurrentChapterId() chapterId: string,
    @Param('id') id: string,
    @Body() dto: UpdateGeofenceDto,
  ) {
    return this.studyService.updateGeofence(id, chapterId, dto);
  }

  @Delete(':id')
  @RequirePermissions(SystemPermissions.GEOFENCES_MANAGE)
  @ApiOperation({ summary: 'Delete geofence (admin)' })
  async delete(@CurrentChapterId() chapterId: string, @Param('id') id: string) {
    await this.studyService.deleteGeofence(id, chapterId);
    return { success: true };
  }
}

@ApiTags('Study Hours')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@Controller('study-sessions')
export class StudySessionController {
  constructor(private readonly studyService: StudyService) {}

  @Post('start')
  @ApiOperation({ summary: 'Start study session (with lat/lng)' })
  async start(
    @CurrentUser('id') userId: string,
    @CurrentChapterId() chapterId: string,
    @Body() dto: StartStudySessionDto,
  ) {
    return this.studyService.startSession(
      userId,
      chapterId,
      dto.geofence_id,
      dto.lat,
      dto.lng,
    );
  }

  @Post('heartbeat')
  @ApiOperation({ summary: 'Send heartbeat (with lat/lng)' })
  async heartbeat(
    @CurrentUser('id') userId: string,
    @CurrentChapterId() chapterId: string,
    @Body() dto: StudySessionHeartbeatDto,
  ) {
    return this.studyService.heartbeat(userId, chapterId, dto.lat, dto.lng);
  }

  @Post('stop')
  @ApiOperation({ summary: 'Stop session and calculate points' })
  async stop(
    @CurrentUser('id') userId: string,
    @CurrentChapterId() chapterId: string,
  ) {
    return this.studyService.stopSession(userId, chapterId);
  }

  @Get()
  @ApiOperation({ summary: 'List own study sessions' })
  async list(
    @CurrentUser('id') userId: string,
    @CurrentChapterId() chapterId: string,
  ) {
    return this.studyService.listSessions(userId, chapterId);
  }
}
