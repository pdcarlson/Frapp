import {
  Body,
  Controller,
  Delete,
  Get,
  InternalServerErrorException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
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
import { ChatService } from '../../application/services/chat.service';
import { ChatMentionService } from '../../application/services/chat-mention.service';
import { ChatAttachmentService } from '../../application/services/chat-attachment.service';
import { ChatNotificationPreferenceService } from '../../application/services/chat-notification-preference.service';
import { ChatCategoryService } from '../../application/services/chat-category.service';
import { ChatReactionService } from '../../application/services/chat-reaction.service';
import { RbacService } from '../../application/services/rbac.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { FreeTier } from '../decorators/subscription.decorator';
import { ThrottleFanOutWrite } from '../decorators/throttle-profiles.decorator';
import {
  FeatureEvent,
  type FeatureEventInput,
} from '../decorators/feature-event.decorator';
import {
  CurrentChapterId,
  CurrentEnabledModules,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { SystemPermissions } from '#domain/constants/permissions';
import {
  CARD_VOTE_ACTION_TYPE,
  cardPollChoiceMode,
  cardPollOptionIds,
  cardVoteSelection,
  type CardPollPayload,
} from '#domain/utils/poll-vote-rules';
import {
  CreateChannelDto,
  UpdateChannelDto,
  CreateDmDto,
  CreateGroupDmDto,
  AddChannelMemberDto,
  ChannelMemberDto,
  CreateCategoryDto,
  UpdateCategoryDto,
  SendMessageDto,
  EditMessageDto,
  ReactionDto,
  ChatMessageActionDto,
  RequestChatUploadUrlDto,
  ChatUploadUrlResponseDto,
  ChannelUnreadCountDto,
  ChannelLatestMessageDto,
  MentionRoleDto,
  SetChannelNotificationLevelDto,
  ChannelNotificationPreferenceDto,
  SetKindNotificationLevelDto,
  KindNotificationPreferenceDto,
  ClearedKindNotificationPreferenceDto,
  ResolveAuthorAvatarsDto,
  GetChannelMessagesQueryDto,
  ChatMessageDto,
} from '../dtos/chat.dto';
import type { ChannelType, ChatChannel } from '#domain/entities/chat.entity';

/** What `POST :id/messages` answers with. */
type SentMessage = Awaited<ReturnType<ChatService['sendMessage']>>;

/** What `POST messages/:messageId/actions` answers with. */
type RecordedMessageAction = Awaited<
  ReturnType<ChatReactionService['recordMessageAction']>
>;

/** The prefix every emoji reaction's `action_type` carries (`reaction:<emoji>`). */
const REACTION_ACTION_PREFIX = 'reaction:';

@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@FreeTier()
@Controller('channels')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly attachments: ChatAttachmentService,
    private readonly notificationPreferences: ChatNotificationPreferenceService,
    private readonly categories: ChatCategoryService,
    private readonly reactions: ChatReactionService,
    private readonly rbacService: RbacService,
    private readonly mentions: ChatMentionService,
  ) {}

  // ── Channels ─────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List chapter channels' })
  async listChannels(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.chatService.getChannelList(chapterId, userId);
  }

  // MUST stay above `@Get(':id')`. Nest matches routes in declaration order and
  // a single-segment `:id` would otherwise swallow this path, resolving it as
  // `getChannel('unread')` and answering 404 for a route that exists.
  // Enforced by `test/route-declaration-order.e2e-spec.ts` (#990).
  @Get('unread')
  @ApiOperation({
    summary: 'Unread and mention counts for every channel the caller can read',
  })
  @ApiOkResponse({ type: ChannelUnreadCountDto, isArray: true })
  async getUnreadCounts(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<ChannelUnreadCountDto[]> {
    return this.chatService.getUnreadCounts(chapterId, userId);
  }

  // MUST stay above `@Get(':id')`, for the same reason as `unread` above.
  // Enforced by `test/route-declaration-order.e2e-spec.ts` (#990).
  @Get('latest')
  @ApiOperation({
    summary:
      'The latest message in every channel the caller can read, for the channel list previews',
  })
  @ApiOkResponse({ type: ChannelLatestMessageDto, isArray: true })
  async getLatestMessages(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<ChannelLatestMessageDto[]> {
    return this.chatService.getLatestMessages(chapterId, userId);
  }

  // MUST stay above `@Get(':id')`, for the same reason as `unread` directly
  // above: `:id` would resolve this as `getChannel('mention-roles')`.
  // Enforced by `test/route-declaration-order.e2e-spec.ts` (#990).
  @Get('mention-roles')
  @ApiOperation({
    summary:
      'The chapter roles the caller’s @-mention picker offers, with whether the caller may ping each',
  })
  @ApiOkResponse({ type: MentionRoleDto, isArray: true })
  async getMentionRoles(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<MentionRoleDto[]> {
    const roles = await this.mentions.listMentionRoles(chapterId, userId);
    return roles.map(({ role_id, name, color, mentionable }) => ({
      role_id,
      name,
      color,
      mentionable,
    }));
  }

  // MUST stay above `@Get(':id')`, for the same reason as `unread` directly
  // above — `:id` is a single segment and would resolve this as
  // `getChannel('notification-preferences')`.
  // Enforced by `test/route-declaration-order.e2e-spec.ts` (#990).
  @Get('notification-preferences')
  @ApiOperation({
    summary: "The caller's own per-channel notification levels",
  })
  @ApiOkResponse({ type: ChannelNotificationPreferenceDto, isArray: true })
  async getChannelNotificationPreferences(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<ChannelNotificationPreferenceDto[]> {
    return this.notificationPreferences.getChannelNotificationPreferences(
      chapterId,
      userId,
    );
  }

  // Two segments, so `@Get(':id')` (a single segment) cannot swallow this the
  // way it would swallow a bare literal. Kept beside the channel-scoped read
  // above because they answer the same question for the two scope arms, and a
  // reader looking for one should find the other.
  @Get('notification-preferences/kinds')
  @ApiOperation({
    summary:
      "The caller's own per-message-kind notification overrides; level is null where none is set. For the level actually applied to a channel, read GET /v1/channels/notification-preferences.",
  })
  @ApiOkResponse({ type: KindNotificationPreferenceDto, isArray: true })
  async getKindNotificationPreferences(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<KindNotificationPreferenceDto[]> {
    return this.notificationPreferences.getKindNotificationPreferences(
      chapterId,
      userId,
    );
  }

  @Put('notification-preferences/kinds/:kind')
  @ApiOperation({
    summary: "Set the caller's notification level for one message kind",
  })
  @ApiOkResponse({ type: KindNotificationPreferenceDto })
  async setKindNotificationLevel(
    @Param('kind') kind: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: SetKindNotificationLevelDto,
  ): Promise<KindNotificationPreferenceDto> {
    return this.notificationPreferences.setKindNotificationLevel(
      chapterId,
      userId,
      kind,
      dto.level,
    );
  }

  @Delete('notification-preferences/kinds/:kind')
  @ApiOperation({
    summary:
      "Clear the caller's override for one message kind, returning it to the default",
  })
  @ApiOkResponse({ type: ClearedKindNotificationPreferenceDto })
  async clearKindNotificationLevel(
    @Param('kind') kind: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<ClearedKindNotificationPreferenceDto> {
    return this.notificationPreferences.clearKindNotificationLevel(
      chapterId,
      userId,
      kind,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get channel by ID' })
  async getChannel(
    @CurrentChapterId() chapterId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.chatService.getChannel(id, chapterId, userId);
  }

  @Post()
  @RequirePermissions(SystemPermissions.CHANNELS_CREATE)
  @ApiOperation({ summary: 'Create a channel' })
  @FeatureEvent(
    'channel-created',
    ({ result }: FeatureEventInput<CreateChannelDto, ChatChannel>) => ({
      type: result.type,
      is_read_only: result.is_read_only,
      has_category: result.category_id != null,
    }),
  )
  async createChannel(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateChannelDto,
  ) {
    return this.chatService.createChannel(
      {
        chapter_id: chapterId,
        name: dto.name,
        description: dto.description,
        type: dto.type as ChannelType,
        required_permissions: dto.required_permissions,
        category_id: dto.category_id,
        is_read_only: dto.is_read_only,
      },
      userId,
    );
  }

  @Patch(':id')
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({ summary: 'Update a channel' })
  async updateChannel(
    @CurrentChapterId() chapterId: string,
    @Param('id') id: string,
    @Body() dto: UpdateChannelDto,
  ) {
    return this.chatService.updateChannel(id, chapterId, dto);
  }

  @Delete(':id')
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({ summary: 'Delete a channel' })
  async deleteChannel(
    @CurrentChapterId() chapterId: string,
    @Param('id') id: string,
  ) {
    await this.chatService.deleteChannel(id, chapterId);
    return { success: true };
  }

  @Post('dm')
  @ApiOperation({ summary: 'Get or create a 1-on-1 DM channel' })
  // Get-or-create, and the result does not say which: reopening an existing
  // DM counts the same as starting one.
  @FeatureEvent('dm-opened')
  async getOrCreateDm(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateDmDto,
  ) {
    return this.chatService.getOrCreateDm(
      { chapter_id: chapterId, member_ids: [userId, dto.member_id] },
      userId,
    );
  }

  @Post('group-dm')
  @ApiOperation({ summary: 'Create a group DM channel' })
  async createGroupDm(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateGroupDmDto,
  ) {
    const memberIds = Array.from(new Set([userId, ...dto.member_ids]));
    return this.chatService.createGroupDm(chapterId, memberIds, dto.name);
  }

  /**
   * No extra `@RequirePermissions`: same reasoning as `markRead` below — a
   * member is leaving a channel they can already read, and the authorization
   * that matters (DM membership) is `assertChannelAccess` in the service, not
   * a chapter-wide permission.
   *
   * The handler keeps its `leaveGroupDm` name because the generated contract's
   * `operationId` derives from it, and renaming an operation breaks every
   * client generated against the old one. What it does now depends on the
   * channel type: see `ChatService.leaveChannel`.
   */
  @Post(':id/leave')
  @ApiOperation({
    summary: 'Leave a Group DM, or hide a 1-on-1 DM from your own list',
  })
  async leaveGroupDm(
    @Param('id') channelId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.chatService.leaveChannel(channelId, chapterId, userId);
    return { success: true };
  }

  /**
   * Everyone who can read the channel, for the member list beside it (#3536).
   * Any reader of the channel may ask; a non-reader gets 403, and a channel in
   * another chapter 404, from the same check every channel read goes through.
   */
  @Get(':id/members')
  @ApiOperation({
    summary: 'Everyone who can read a channel, with their top role rank',
  })
  @ApiOkResponse({ type: ChannelMemberDto, isArray: true })
  async listChannelMembers(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) channelId: string,
  ): Promise<ChannelMemberDto[]> {
    return this.chatService.listChannelMembers(channelId, chapterId, userId);
  }

  /**
   * PRIVATE channel membership (#1302). `channels:manage`, like `PATCH` and
   * `DELETE` on a channel, and deliberately not per-user ACL'd: an officer
   * can manage a private channel they cannot read. Rules:
   * `ChatService.addPrivateChannelMember` / `removePrivateChannelMember`.
   */
  @Post(':id/members')
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({ summary: 'Add a chapter member to a private channel' })
  async addChannelMember(
    @CurrentChapterId() chapterId: string,
    @Param('id', ParseUUIDPipe) channelId: string,
    @Body() dto: AddChannelMemberDto,
  ) {
    return this.chatService.addPrivateChannelMember(
      channelId,
      chapterId,
      dto.user_id,
    );
  }

  @Delete(':id/members/:userId')
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({
    summary:
      'Remove someone from a private channel (409 if it would leave no chapter member who can read it)',
  })
  async removeChannelMember(
    @CurrentChapterId() chapterId: string,
    @Param('id', ParseUUIDPipe) channelId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.chatService.removePrivateChannelMember(
      channelId,
      chapterId,
      userId,
    );
  }

  // ── Categories ───────────────────────────────────────────────────────

  @Get('categories/list')
  @ApiOperation({ summary: 'List channel categories' })
  async listCategories(@CurrentChapterId() chapterId: string) {
    return this.categories.getCategories(chapterId);
  }

  @Post('categories')
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({ summary: 'Create a channel category' })
  async createCategory(
    @CurrentChapterId() chapterId: string,
    @Body() dto: CreateCategoryDto,
  ) {
    return this.categories.createCategory({
      chapter_id: chapterId,
      name: dto.name,
      display_order: dto.display_order,
    });
  }

  @Patch('categories/:id')
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({ summary: 'Update a channel category' })
  async updateCategory(
    @Param('id') id: string,
    @CurrentChapterId() chapterId: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categories.updateCategory(id, chapterId, dto);
  }

  @Delete('categories/:id')
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({ summary: 'Delete a channel category' })
  async deleteCategory(
    @Param('id') id: string,
    @CurrentChapterId() chapterId: string,
  ) {
    await this.categories.deleteCategory(id, chapterId);
    return { success: true };
  }

  // ── Messages ─────────────────────────────────────────────────────────

  /**
   * Declared response schema, not decoration. Without it `openapi.json` carries
   * no 200 body for this route and `openapi-typescript` types the response
   * `never` (#1049) — which is how `sender_blocked` came to be emitted by the
   * API and invisible to every typed client, leaving the machine-readable half
   * of `spec/behavior/chat/README.md` § The masking contract unreachable.
   */
  @Get(':id/messages')
  @ApiOperation({
    summary: 'Get channel message history (supports since= reconnect replay)',
  })
  @ApiOkResponse({ type: ChatMessageDto, isArray: true })
  async getMessages(
    @Param('id') channelId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Query() query: GetChannelMessagesQueryDto,
  ) {
    return this.chatService.getMessages(channelId, chapterId, userId, {
      limit: query.limit,
      before: query.before,
      since: query.since,
    });
  }

  @Post(':id/messages')
  @ApiOperation({
    summary: 'Send a message (hot path; idempotent on client_message_id)',
  })
  // A retry on the same `client_message_id` answers `deduplicated: true`, and
  // records nothing: the message was counted when it was first written.
  @FeatureEvent(
    'message-sent',
    ({ body, result }: FeatureEventInput<SendMessageDto, SentMessage>) =>
      result.deduplicated
        ? null
        : {
            kind: result.message.kind ?? 'text',
            is_reply: !!result.message.reply_to_id,
            // From the request, not `metadata.attachment_count`: with no
            // attachments the row's metadata is the client's own, verbatim.
            attachment_count: Array.isArray(body.attachments)
              ? body.attachments.length
              : 0,
          },
  )
  // Web's `/poll` and New poll dialog, and mobile's New poll sheet, post a `kind: 'poll'` message
  // through this route (`buildPollMessage` in `@repo/chat-core/polls`).
  @FeatureEvent(
    'poll-created',
    ({ body, result }: FeatureEventInput<SendMessageDto, SentMessage>) => {
      if (result.deduplicated || result.message.kind !== 'poll') return null;
      // Read as the card vote rules read it (`poll-vote-rules.ts`).
      const poll = (body.payload ?? {}) as CardPollPayload;
      return {
        choice_mode: cardPollChoiceMode(poll),
        option_count: cardPollOptionIds(poll)?.length ?? 0,
        has_expiry: typeof poll.closes_at === 'string' && poll.closes_at !== '',
      };
    },
  )
  // `/announce` posts a `kind: 'announcement'` message through this route.
  @FeatureEvent(
    'announcement-posted',
    ({ result }: FeatureEventInput<SendMessageDto, SentMessage>) =>
      result.deduplicated || result.message.kind !== 'announcement' ? null : {},
  )
  async sendMessage(
    @Param('id') channelId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @CurrentEnabledModules() enabledModules: Record<string, boolean> | null,
    @Body() dto: SendMessageDto,
  ) {
    return this.chatService.sendMessage({
      chapter_id: chapterId,
      channel_id: channelId,
      sender_id: userId,
      content: dto.content,
      client_message_id: dto.client_message_id,
      kind: dto.kind,
      payload: dto.payload,
      reply_to_id: dto.reply_to_id,
      thread_root_id: dto.thread_root_id,
      metadata: dto.metadata,
      attachments: dto.attachments,
      enabled_modules: enabledModules,
    });
  }

  /**
   * Attachments on one message, each with a signed download URL.
   *
   * A route of its own rather than a field on the message read: the URLs expire,
   * so they have to be minted when they are about to be used, and the clients'
   * message caches are fed partly by Realtime rows, which cannot carry a join at
   * all. `metadata.attachment_count` on the message row is what tells a client
   * this is worth calling.
   */
  @Get(':id/messages/:messageId/attachments')
  @ApiOperation({
    summary: 'Attachments on a message, with signed download URLs',
  })
  async listMessageAttachments(
    @Param('id') channelId: string,
    @Param('messageId') messageId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.attachments.listMessageAttachments(
      channelId,
      chapterId,
      userId,
      messageId,
    );
  }

  /**
   * Signed URLs for imported-author avatars (#1231).
   *
   * A route of its own for the same reason `listMessageAttachments` is: the
   * URLs expire, so they mint on request rather than riding a cacheable
   * message field. Nested under `:id` like `listMessageAttachments` — the
   * avatar path set is derived server-side from the given message ids
   * (`ChatAttachmentService.resolveAuthorAvatars` → `findAuthorAvatarPaths`), never
   * from a caller-supplied storage path, so the ordinary channel-access
   * check applies exactly as it does for attachments.
   */
  @Post(':id/messages/avatars')
  @ApiOperation({
    summary: "Signed download URLs for a set of messages' author avatars",
  })
  async resolveAuthorAvatars(
    @Param('id') channelId: string,
    @Body() dto: ResolveAuthorAvatarsDto,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.attachments.resolveAuthorAvatars(
      channelId,
      chapterId,
      userId,
      dto.message_ids,
    );
  }

  @Patch('messages/:messageId')
  @ApiOperation({ summary: 'Edit a message (own only)' })
  async editMessage(
    @Param('messageId') messageId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: EditMessageDto,
  ) {
    return this.chatService.editMessage(
      messageId,
      chapterId,
      userId,
      dto.content,
    );
  }

  @Delete('messages/:messageId')
  @ApiOperation({
    summary:
      'Delete a message (soft delete; own message, or any in an accessible channel with channels:manage)',
  })
  async deleteMessage(
    @Param('messageId') messageId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    // spec/behavior/chat/README.md lets a `channels:manage` holder moderate
    // other members' messages. This route previously hardcoded `false`, so that
    // path could never fire. Resolving the permission here (rather than via
    // @RequirePermissions) keeps the endpoint open to authors deleting their
    // own messages; the service still re-checks channel access in the active
    // chapter before honouring either path.
    const hasManagePermission = await this.rbacService.memberHasAnyPermission(
      chapterId,
      userId,
      [SystemPermissions.CHANNELS_MANAGE],
    );

    return this.chatService.deleteMessage(
      messageId,
      chapterId,
      userId,
      hasManagePermission,
    );
  }

  // ── Pins ─────────────────────────────────────────────────────────────

  @Get(':id/pins')
  @ApiOperation({ summary: 'Get pinned messages in a channel' })
  // Masked exactly like `GET :id/messages`, so it owes the same declared
  // schema — a pin is channel content that stays in front of the blocker
  // indefinitely, and a client cannot honour `sender_blocked` it cannot see.
  @ApiOkResponse({ type: ChatMessageDto, isArray: true })
  async getPinnedMessages(
    @Param('id') channelId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.chatService.getPinnedMessages(channelId, chapterId, userId);
  }

  @Post('messages/:messageId/pin')
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({ summary: 'Pin a message' })
  async pinMessage(
    @Param('messageId') messageId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.chatService.pinMessage(messageId, chapterId, userId);
  }

  @Delete('messages/:messageId/pin')
  @RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
  @ApiOperation({ summary: 'Unpin a message' })
  async unpinMessage(
    @Param('messageId') messageId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.chatService.unpinMessage(messageId, chapterId, userId);
  }

  // ── Actions (chat_message_actions hot-path: reactions / votes / RSVPs) ──

  @Post('messages/:messageId/actions')
  @ApiOperation({
    summary:
      'Record a reaction / vote / card action (hot path; atomic dedup; vote UPSERTS)',
  })
  // Neither event carries the `action_type`: a reaction's holds the emoji, and
  // any other is free-form. A repeated reaction answers `deduplicated: true`
  // and records nothing. Removing one goes to `chat_message_actions` directly
  // (`unreact` in `@repo/chat-core/chat-client`), so no event sees it.
  @FeatureEvent(
    'message-reacted',
    ({
      body,
      result,
    }: FeatureEventInput<ChatMessageActionDto, RecordedMessageAction>) =>
      typeof body.action_type === 'string' &&
      body.action_type.startsWith(REACTION_ACTION_PREFIX) &&
      !result.deduplicated
        ? {}
        : null,
  )
  // The chat poll card's vote. A vote is never `deduplicated`: a second one
  // replaces the first (ADR-07) and answers `updated: true`, even when it
  // picks the same option again, so `is_revote` means "replaced an earlier
  // vote", not "changed the answer". A multi-choice vote with nothing selected
  // clears the vote, which is not a vote cast.
  @FeatureEvent(
    'poll-voted',
    ({
      body,
      result,
    }: FeatureEventInput<ChatMessageActionDto, RecordedMessageAction>) => {
      if (body.action_type !== CARD_VOTE_ACTION_TYPE || result.deduplicated) {
        return null;
      }
      const selectedCount = cardVoteSelection(body.payload).length;
      if (selectedCount === 0) return null;
      return {
        surface: 'card',
        selected_count: selectedCount,
        is_revote: result.updated === true,
      };
    },
  )
  async recordMessageAction(
    @Param('messageId') messageId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @CurrentEnabledModules() enabledModules: Record<string, boolean> | null,
    @Body() dto: ChatMessageActionDto,
  ) {
    return this.reactions.recordMessageAction(
      messageId,
      chapterId,
      userId,
      { action_type: dto.action_type, payload: dto.payload },
      enabledModules,
    );
  }

  // ── Reactions ────────────────────────────────────────────────────────

  @Post('messages/:messageId/reactions')
  @ApiOperation({ summary: 'Toggle reaction (add/remove)' })
  async toggleReaction(
    @Param('messageId') messageId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ReactionDto,
  ) {
    return this.reactions.toggleReaction(
      messageId,
      chapterId,
      userId,
      dto.emoji,
    );
  }

  @Get('messages/:messageId/reactions')
  @ApiOperation({ summary: 'Get reactions for a message' })
  async getReactions(
    @Param('messageId') messageId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.reactions.getReactions(messageId, chapterId, userId);
  }

  // ── File Upload ────────────────────────────────────────────────────

  @Post(':id/upload-url')
  @ThrottleFanOutWrite()
  @ApiOperation({
    summary: 'Generate a signed upload URL for a chat file attachment',
  })
  @ApiCreatedResponse({ type: ChatUploadUrlResponseDto })
  async requestUploadUrl(
    @Param('id') channelId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: RequestChatUploadUrlDto,
  ): Promise<ChatUploadUrlResponseDto> {
    // Same mapping as BackworkController.requestUploadUrl (#2129) — the
    // service ticket is camelCase, the wire contract is snake_case. This 201
    // used to pass the service object straight through with no response DTO,
    // so OpenAPI documented it as empty and the composer had to read it
    // through an `as unknown as` cast.
    const ticket = await this.attachments.requestChatUploadUrl(
      channelId,
      chapterId,
      userId,
      dto.filename,
      dto.content_type,
      dto.size_bytes,
      dto.with_preview ?? false,
    );
    if (!ticket.signedUrl || !ticket.storagePath) {
      throw new InternalServerErrorException(
        'Storage did not return a signed upload URL or storage path.',
      );
    }
    return {
      upload_url: ticket.signedUrl,
      storage_path: ticket.storagePath,
      message_id: ticket.messageId,
      ...('previewSignedUrl' in ticket
        ? {
            preview_upload_url: ticket.previewSignedUrl,
            preview_storage_path: ticket.previewStoragePath,
          }
        : {}),
    };
  }

  // ── Read Receipts ────────────────────────────────────────────────────

  @Post(':id/read')
  @ApiOperation({ summary: 'Mark channel as read' })
  async markRead(
    @Param('id') channelId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.chatService.markChannelRead(channelId, chapterId, userId);
  }

  // ── Per-channel notification level (mute) ────────────────────────────

  /**
   * Two segments, so unlike the GET above this one cannot be swallowed by
   * `@Patch(':id')` — but it is kept beside the read-receipt route, which is
   * its closest sibling: both are per-user writes scoped to one channel.
   *
   * No extra `@RequirePermissions`: the class-level `MEMBERS_VIEW` is the right
   * gate, because a member is changing *their own* notification settings for a
   * channel they can already read. The authorization that matters is
   * `assertChannelAccess` in the service, not a chapter-wide permission.
   */
  @Put(':id/notification-preference')
  @ApiOperation({
    summary: "Set the caller's notification level for a channel",
  })
  @ApiOkResponse({ type: ChannelNotificationPreferenceDto })
  async setChannelNotificationLevel(
    @Param('id', ParseUUIDPipe) channelId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: SetChannelNotificationLevelDto,
  ): Promise<ChannelNotificationPreferenceDto> {
    return this.notificationPreferences.setChannelNotificationLevel(
      channelId,
      chapterId,
      userId,
      dto.level,
    );
  }
}
