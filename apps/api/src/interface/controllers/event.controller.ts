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
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { EventService } from '../../application/services/event.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { CurrentChapterId } from '../decorators/current-user.decorator';
import { CreateEventDto, UpdateEventDto } from '../dtos/event.dto';
import { SystemPermissions } from '../../domain/constants/permissions';

@ApiTags('Events')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
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
  @RequirePermissions(SystemPermissions.EVENTS_CREATE)
  @ApiOperation({ summary: 'Create an event' })
  async create(
    @CurrentChapterId() chapterId: string,
    @Body() dto: CreateEventDto,
  ) {
    return this.eventService.create({
      chapter_id: chapterId,
      ...dto,
    });
  }

  @Patch(':id')
  @RequirePermissions(SystemPermissions.EVENTS_UPDATE)
  @ApiOperation({ summary: 'Update an event' })
  async update(
    @CurrentChapterId() chapterId: string,
    @Param('id') id: string,
    @Body() dto: UpdateEventDto,
  ) {
    return this.eventService.update(id, chapterId, dto);
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
  @ApiOperation({ summary: 'Delete an event' })
  @ApiQuery({
    name: 'scope',
    required: false,
    enum: ['this_instance', 'this_and_future', 'entire_series'],
    description:
      'For recurring events: this_instance (default), this_and_future, or entire_series',
  })
  async delete(
    @CurrentChapterId() chapterId: string,
    @Param('id') id: string,
    @Query('scope')
    scope?: 'this_instance' | 'this_and_future' | 'entire_series',
  ) {
    await this.eventService.delete(id, chapterId, { scope });
    return { success: true };
  }
}
