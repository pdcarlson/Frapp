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
@UseGuards(SupabaseAuthGuard, ChapterGuard)
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
  @UseGuards(PermissionsGuard)
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
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.EVENTS_UPDATE)
  @ApiOperation({ summary: 'Update an event' })
  async update(
    @CurrentChapterId() chapterId: string,
    @Param('id') id: string,
    @Body() dto: UpdateEventDto,
  ) {
    return this.eventService.update(id, chapterId, dto);
  }

  @Delete(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.EVENTS_DELETE)
  @ApiOperation({ summary: 'Delete an event' })
  async delete(@CurrentChapterId() chapterId: string, @Param('id') id: string) {
    await this.eventService.delete(id, chapterId);
    return { success: true };
  }
}
