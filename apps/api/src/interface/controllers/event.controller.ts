import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { EventService } from '../../application/services/event.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { RequireModule } from '../decorators/module.decorator';
import { ThrottleFanOutWrite } from '../decorators/throttle-profiles.decorator';
import {
  FeatureEvent,
  type FeatureEventInput,
} from '../decorators/feature-event.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import {
  CreateEventDto,
  CreateEventResponseDto,
  DeleteEventQueryDto,
  EventDetailResponseDto,
  EventResponseDto,
  UpdateEventDto,
} from '../dtos/event.dto';
import { SystemPermissions } from '#domain/constants/permissions';
import { TIME_ZONE_HEADER } from '#domain/constants/time-zone-header';

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
  @ApiOkResponse({ type: [EventResponseDto] })
  async list(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<EventResponseDto[]> {
    return this.eventService.findByChapter(chapterId, userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get event by id' })
  @ApiOkResponse({ type: EventDetailResponseDto })
  async getOne(
    @CurrentChapterId() chapterId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ): Promise<EventDetailResponseDto> {
    const event = await this.eventService.findById(id, chapterId, userId);
    // Additive (#4808): whether check-in now needs the officer's code, so web
    // says to scan rather than offering a Check in the server refuses. Never
    // fails the read (`checkInNeedsCode`).
    const checkInNeedsCode = await this.eventService.checkInNeedsCode(event);
    return { ...event, check_in_needs_code: checkInNeedsCode };
  }

  @Post()
  @ThrottleFanOutWrite()
  @RequirePermissions(SystemPermissions.EVENTS_CREATE)
  @ApiOperation({ summary: 'Create an event' })
  @ApiCreatedResponse({ type: CreateEventResponseDto })
  // From the created parent row, where the server has applied its defaults
  // (`point_value` 10, `is_mandatory` false). A recurring create is one event.
  @FeatureEvent(
    'event-created',
    ({
      result,
    }: FeatureEventInput<CreateEventDto, CreateEventResponseDto>) => ({
      is_mandatory: result.is_mandatory,
      is_recurring: result.recurrence_rule != null,
      has_check_in_zone: result.check_in_zone != null,
      has_point_value: result.point_value > 0,
      posted_to_chat: result.card_posted === true,
    }),
  )
  async create(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') createdBy: string,
    @Body() dto: CreateEventDto,
    // A legacy repeat token keeps the wall clock of the device's zone (#4746).
    @Headers(TIME_ZONE_HEADER) timeZone: string | undefined,
  ) {
    return this.eventService.create(
      {
        // Server-decided keys go last so they win the spread. With the DTO
        // spread last instead, adding a `chapter_id` property to CreateEventDto
        // would silently let a caller write into another chapter — the whitelist
        // pipe is what stops that today, and this ordering is what stops it if
        // the DTO ever changes.
        ...dto,
        chapter_id: chapterId,
        created_by: createdBy,
      },
      timeZone,
    );
  }

  @Patch(':id')
  @ThrottleFanOutWrite()
  @RequirePermissions(SystemPermissions.EVENTS_UPDATE)
  @ApiOperation({ summary: 'Update an event' })
  async update(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') actorId: string,
    @Param('id') id: string,
    @Body() dto: UpdateEventDto,
    @Headers(TIME_ZONE_HEADER) timeZone: string | undefined,
  ) {
    // `scope` is a control flag, not a column. Split it off here so it can never
    // reach the repository's update payload as a stray field.
    const { scope, ...patch } = dto;
    return this.eventService.update(
      id,
      chapterId,
      patch,
      scope,
      actorId,
      timeZone,
    );
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
