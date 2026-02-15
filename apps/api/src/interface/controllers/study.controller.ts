import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { StudyService } from '../../application/services/study.service';
import { UserService } from '../../application/services/user.service';
import { StartSessionDto, HeartbeatDto } from '../dtos/study.dto';
import { ClerkAuthGuard } from '../guards/clerk-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import type { RequestWithUser } from '../auth.types';

@ApiTags('study')
@Controller('study')
@UseGuards(ClerkAuthGuard, ChapterGuard)
@ApiBearerAuth()
@ApiHeader({ name: 'x-chapter-id', required: true })
export class StudyController {
  constructor(
    private readonly studyService: StudyService,
    private readonly userService: UserService,
  ) {}

  @Get('geofences')
  @ApiOperation({ summary: 'List available study locations' })
  async getGeofences(@Req() req: RequestWithUser) {
    const chapterId = req.headers['x-chapter-id'] as string;
    return this.studyService.getGeofences(chapterId);
  }

  @Post('sessions/start')
  @ApiOperation({ summary: 'Start a new study session' })
  async startSession(
    @Req() req: RequestWithUser,
    @Body() dto: StartSessionDto,
  ) {
    const chapterId = req.headers['x-chapter-id'] as string;
    const user = await this.userService.findByClerkId(req.user.sub);

    return this.studyService.startSession(
      user.id,
      chapterId,
      dto.geofenceId,
      dto.latitude,
      dto.longitude,
    );
  }

  @Post('sessions/heartbeat')
  @ApiOperation({ summary: 'Send GPS heartbeat to maintain session' })
  async heartbeat(@Req() req: RequestWithUser, @Body() dto: HeartbeatDto) {
    const user = await this.userService.findByClerkId(req.user.sub);
    await this.studyService.processHeartbeat(
      user.id,
      dto.latitude,
      dto.longitude,
    );
    return { success: true };
  }

  @Post('sessions/stop')
  @ApiOperation({ summary: 'End study session and claim points' })
  async stopSession(@Req() req: RequestWithUser) {
    const user = await this.userService.findByClerkId(req.user.sub);
    return this.studyService.stopSession(user.id);
  }
}
