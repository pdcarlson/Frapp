import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Req,
  Param,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { EventService } from '../../application/services/event.service';
import { AttendanceService } from '../../application/services/attendance.service';
import { UserService } from '../../application/services/user.service';
import { CreateEventDto, QrCheckInDto } from '../dtos/event.dto';
import { ClerkAuthGuard } from '../guards/clerk-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { PERMISSIONS } from '../../domain/constants/permissions';
import type { RequestWithUser } from '../auth.types';
import { QrTokenService } from '../../application/services/qr-token.service';

@ApiTags('events')
@Controller('events')
@UseGuards(ClerkAuthGuard, ChapterGuard, PermissionsGuard)
@ApiBearerAuth()
@ApiHeader({ name: 'x-chapter-id', required: true })
export class EventController {
  constructor(
    private readonly eventService: EventService,
    private readonly attendanceService: AttendanceService,
    private readonly userService: UserService,
    private readonly qrTokenService: QrTokenService,
  ) {}

  @Get(':id/qr')
  @ApiOperation({ summary: 'Get a dynamic QR token for an event' })
  @RequirePermissions(PERMISSIONS.EVENTS_UPDATE) // Or a specific QR permission if added
  async getQrToken(@Req() req: RequestWithUser, @Param('id') id: string) {
    const chapterId = req.headers['x-chapter-id'] as string;
    const token = await Promise.resolve(
      this.qrTokenService.generateToken(id, chapterId),
    );
    return { token, expiresIn: 30 };
  }

  @Post(':id/qr-check-in')
  @ApiOperation({ summary: 'Check in via QR code' })
  async qrCheckIn(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: QrCheckInDto,
  ) {
    const user = await this.userService.findByClerkId(req.user.sub);
    return this.attendanceService.processQrCheckIn(user.id, dto.token);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new event' })
  @RequirePermissions(PERMISSIONS.EVENTS_CREATE)
  async createEvent(@Req() req: RequestWithUser, @Body() dto: CreateEventDto) {
    const chapterId = req.headers['x-chapter-id'] as string;
    return this.eventService.createEvent({
      ...dto,
      chapterId,
      description: dto.description ?? null,
      startTime: new Date(dto.startTime),
      endTime: new Date(dto.endTime),
    });
  }

  @Get()
  @ApiOperation({ summary: 'Get all events for the chapter' })
  @RequirePermissions(PERMISSIONS.EVENTS_VIEW)
  async getEvents(@Req() req: RequestWithUser) {
    const chapterId = req.headers['x-chapter-id'] as string;
    return this.eventService.getChapterEvents(chapterId);
  }

  @Post(':id/check-in')
  @ApiOperation({ summary: 'Self-service check-in to an event' })
  async checkIn(@Req() req: RequestWithUser, @Param('id') id: string) {
    const chapterId = req.headers['x-chapter-id'] as string;
    const clerkId = req.user.sub;
    const user = await this.userService.findByClerkId(clerkId);

    return this.attendanceService.checkIn(user.id, chapterId, id);
  }

  @Get(':id/attendance')
  @ApiOperation({ summary: 'Get attendance list for an event' })
  @RequirePermissions(PERMISSIONS.EVENTS_VIEW)
  async getAttendance(@Param('id') id: string) {
    return this.attendanceService.getAttendanceForEvent(id);
  }
}
