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
import { CreateEventDto } from '../dtos/event.dto';
import { ClerkAuthGuard } from '../guards/clerk-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import type { RequestWithUser } from '../auth.types';

@ApiTags('events')
@Controller('events')
@UseGuards(ClerkAuthGuard, ChapterGuard)
@ApiBearerAuth()
@ApiHeader({ name: 'x-chapter-id', required: true })
export class EventController {
  constructor(
    private readonly eventService: EventService,
    private readonly attendanceService: AttendanceService,
    private readonly userService: UserService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new event (Admin Only - TODO: RBAC)' })
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
  @ApiOperation({ summary: 'Get attendance list for an event (Admin Only)' })
  async getAttendance(@Param('id') id: string) {
    return this.attendanceService.getAttendanceForEvent(id);
  }
}
