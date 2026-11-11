import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { EventTypeService } from '../../application/services/event-type.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { RequireModule } from '../decorators/module.decorator';
import { CurrentChapterId } from '../decorators/current-user.decorator';
import { SystemPermissions } from '#domain/constants/permissions';
import {
  CreateEventTypeDto,
  EventTypeDto,
  UpdateEventTypeDto,
} from '../dtos/event-type.dto';

/**
 * A chapter's event types (#3730).
 *
 * Reads need `members:view`, like the events they label. Writes need
 * `events:update`: the officers who may edit any event decide what kinds there
 * are and what each is worth, since a member who can only create events gets
 * a type's points without choosing them. Same module and tier as
 * `EventController`.
 */
@ApiTags('Event types')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@RequireModule('events')
@Controller('event-types')
export class EventTypeController {
  constructor(private readonly eventTypeService: EventTypeService) {}

  @Get()
  @ApiOperation({ summary: "List the chapter's event types, in its order" })
  @ApiOkResponse({ type: EventTypeDto, isArray: true })
  async list(@CurrentChapterId() chapterId: string) {
    return this.eventTypeService.list(chapterId);
  }

  @Post()
  @ApiOperation({ summary: 'Add an event type at the end of the list' })
  @ApiCreatedResponse({ type: EventTypeDto })
  @RequirePermissions(SystemPermissions.EVENTS_UPDATE)
  async create(
    @CurrentChapterId() chapterId: string,
    @Body() dto: CreateEventTypeDto,
  ) {
    return this.eventTypeService.create(chapterId, dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      "Change an event type's name, points or attendance; events already made keep theirs",
  })
  @ApiOkResponse({ type: EventTypeDto })
  @RequirePermissions(SystemPermissions.EVENTS_UPDATE)
  async update(
    @CurrentChapterId() chapterId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEventTypeDto,
  ) {
    return this.eventTypeService.update(id, chapterId, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary:
      'Delete an event type; its events keep their points and attendance and lose the type',
  })
  @RequirePermissions(SystemPermissions.EVENTS_UPDATE)
  async remove(
    @CurrentChapterId() chapterId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.eventTypeService.remove(id, chapterId);
    return { success: true };
  }
}
