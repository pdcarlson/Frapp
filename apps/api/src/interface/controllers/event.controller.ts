import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { EventService } from '../../application/services/event.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { RequireModule } from '../decorators/module.decorator';
import { ThrottleFanOutWrite } from '../decorators/throttle-profiles.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import {
  CreateEventDto,
  DeleteEventQueryDto,
  UpdateEventDto,
} from '../dtos/event.dto';
import { SystemPermissions } from '../../domain/constants/permissions';

@ApiTags('Events')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@RequireModule('events')
@Controller('events')
export class EventController {
  constructor(private readonly eventService: EventService) {}

  @Get()
  @ApiOperation({ summary: 'List chapter events' })
  async list(@CurrentChapterId() chapterId: string) {
    return this.eventService.findByChapter(chapterId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get event by id' })
  async getOne(@CurrentChapterId() chapterId: string, @Param('id') id: string) {
    return this.eventService.findById(id, chapterId);
  }

  @Post()
  @ThrottleFanOutWrite()
  @RequirePermissions(SystemPermissions.EVENTS_CREATE)
  @ApiOperation({ summary: 'Create an event' })
  async create(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') createdBy: string,
    @Body() dto: CreateEventDto,
  ) {
    return this.eventService.create({
      // Server-decided keys go last so they win the spread. With the DTO
      // spread last instead, adding a `chapter_id` property to CreateEventDto
      // would silently let a caller write into another chapter — the whitelist
      // pipe is what stops that today, and this ordering is what stops it if
      // the DTO ever changes.
      ...dto,
      chapter_id: chapterId,
      created_by: createdBy,
    });
  }

  @Patch(':id')
  @ThrottleFanOutWrite()
  @RequirePermissions(SystemPermissions.EVENTS_UPDATE)
  @ApiOperation({ summary: 'Update an event' })
  async update(
    @CurrentChapterId() chapterId: string,
    @Param('id') id: string,
    @Body() dto: UpdateEventDto,
  ) {
    // `scope` is a control flag, not a column. Split it off here so it can never
    // reach the repository's update payload as a stray field.
    const { scope, ...patch } = dto;
    return this.eventService.update(id, chapterId, patch, scope);
  }

  @Get(':id/ics')
  @ApiOperation({ summary: 'Download .ics calendar file for an event' })
  @ApiProduces('text/calendar')
  async getIcs(
    @CurrentChapterId() chapterId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const ics = await this.eventService.generateIcs(id, chapterId);
    res.set({
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${id}.ics"`,
    });
    res.send(ics);
  }

  @Delete(':id')
  @RequirePermissions(SystemPermissions.EVENTS_DELETE)
  @ApiOperation({
    summary: 'Delete an event, or cancel a recurring series from now forward',
  })
  async delete(
    @CurrentChapterId() chapterId: string,
    @Param('id') id: string,
    @Query() query: DeleteEventQueryDto,
  ) {
    await this.eventService.delete(id, chapterId, query.scope);
    return { success: true };
  }
}
