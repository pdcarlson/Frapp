import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { EventExcuseService } from '../../application/services/event-excuse.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { RequireModule } from '../decorators/module.decorator';
import {
  FeatureEvent,
  type FeatureEventInput,
} from '../decorators/feature-event.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import {
  DecideEventExcuseDto,
  EventExcuseDto,
  EventExcuseWithMemberDto,
  MyEventExcuseDto,
  SubmitEventExcuseDto,
} from '../dtos/event-excuse.dto';
import { EVENT_EXCUSE_LATE_HOURS } from '@repo/validation';
import { SystemPermissions } from '#domain/constants/permissions';

/**
 * Absence excuses for required events (#3735; `spec/behavior/events.md`
 * § Excuses).
 *
 * Every route needs `members:view`, the gate `GET /v1/events/:id` carries, so
 * no route here answers for an event that one refuses. Who may decide (the
 * event's creator, or an `events:update` holder) depends on the event row, so
 * the service checks it rather than a decorator: the creator of a member-made
 * event holds no officer permission.
 */
@ApiTags('Event excuses')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@RequireModule('events')
@Controller('events/:eventId/excuses')
export class EventExcuseController {
  constructor(private readonly excuses: EventExcuseService) {}

  @Post()
  @ApiOperation({
    summary: 'Send an excuse for an event that requires you',
    description: `Any time before the event and up to ${EVENT_EXCUSE_LATE_HOURS} hours after it ends. 400 when the event does not require the caller or the window has closed; 409 when they already sent one, checked in, or are already excused. The receiver is pushed.`,
  })
  @ApiCreatedResponse({ type: EventExcuseDto })
  @FeatureEvent('event-excuse-sent')
  async submit(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser('id') userId: string,
    @CurrentChapterId() chapterId: string,
    @Body() dto: SubmitEventExcuseDto,
  ): Promise<EventExcuseDto> {
    return this.excuses.submit(eventId, userId, chapterId, dto.reason);
  }

  // A literal segment, declared before `:userId`, so it never reads as an id.
  @Get('me')
  @ApiOperation({
    summary: "The caller's own excuse for an event, and who receives it",
  })
  @ApiOkResponse({ type: MyEventExcuseDto })
  async mine(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser('id') userId: string,
    @CurrentChapterId() chapterId: string,
  ): Promise<MyEventExcuseDto> {
    return this.excuses.getMine(eventId, userId, chapterId);
  }

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Withdraw your pending or approved excuse',
    description:
      'Only until check-in closes. Withdrawing an approved excuse also removes the EXCUSED attendance it wrote, so the member can check in. 409 for a declined excuse or a finished event.',
  })
  @ApiNoContentResponse()
  async withdraw(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser('id') userId: string,
    @CurrentChapterId() chapterId: string,
  ): Promise<void> {
    await this.excuses.withdraw(eventId, userId, chapterId);
  }

  @Get()
  @ApiOperation({
    summary: "List an event's excuses (its creator, or events:update)",
  })
  @ApiOkResponse({ type: EventExcuseWithMemberDto, isArray: true })
  async list(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser('id') userId: string,
    @CurrentChapterId() chapterId: string,
  ): Promise<EventExcuseWithMemberDto[]> {
    return this.excuses.list(eventId, chapterId, userId);
  }

  @Patch(':userId')
  @ApiOperation({
    summary: "Approve or decline a member's pending excuse",
    description:
      "The event's creator (not for their own excuse) or an events:update holder. Approving writes the member's attendance EXCUSED with the reason; declining after check-in closes marks them ABSENT while the event still requires them. 409 when it was already decided, the member checked in or left the chapter, or (approving) an officer marked them ABSENT.",
  })
  @ApiOkResponse({ type: EventExcuseDto })
  @FeatureEvent(
    'event-excuse-decided',
    ({ body }: FeatureEventInput<DecideEventExcuseDto>) => ({
      decision: body.decision,
    }),
  )
  async decide(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('userId', ParseUUIDPipe) excuseUserId: string,
    @CurrentUser('id') deciderId: string,
    @CurrentChapterId() chapterId: string,
    @Body() dto: DecideEventExcuseDto,
  ): Promise<EventExcuseDto> {
    return this.excuses.decide(
      eventId,
      excuseUserId,
      chapterId,
      deciderId,
      dto.decision,
    );
  }
}
