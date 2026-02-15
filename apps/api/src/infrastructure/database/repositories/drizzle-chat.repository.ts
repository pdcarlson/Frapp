import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, desc } from 'drizzle-orm';
import * as schema from '../schema';
import { DRIZZLE_DB } from '../drizzle.provider';
import { IChatRepository } from '../../../domain/repositories/chat.repository.interface';
import { ChatChannel, ChatMessage } from '../../../domain/entities/chat.entity';

@Injectable()
export class DrizzleChatRepository implements IChatRepository {
  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async createChannel(
    channel: Omit<ChatChannel, 'id' | 'createdAt'>,
  ): Promise<ChatChannel> {
    const [result] = await this.db
      .insert(schema.chatChannels)
      .values({
        chapterId: channel.chapterId,
        name: channel.name,
        description: channel.description,
        type: channel.type,
        allowedRoleIds: channel.allowedRoleIds,
      })
      .returning();

    return new ChatChannel(
      result.id,
      result.chapterId,
      result.name,
      result.description,
      result.type as 'PUBLIC' | 'PRIVATE' | 'ROLE_GATED',
      result.allowedRoleIds,
      result.createdAt,
    );
  }

  async findChannelById(id: string): Promise<ChatChannel | null> {
    const [result] = await this.db
      .select()
      .from(schema.chatChannels)
      .where(eq(schema.chatChannels.id, id))
      .limit(1);

    if (!result) return null;
    return new ChatChannel(
      result.id,
      result.chapterId,
      result.name,
      result.description,
      result.type as 'PUBLIC' | 'PRIVATE' | 'ROLE_GATED',
      result.allowedRoleIds,
      result.createdAt,
    );
  }

  async findChannelsByChapter(chapterId: string): Promise<ChatChannel[]> {
    const results = await this.db
      .select()
      .from(schema.chatChannels)
      .where(eq(schema.chatChannels.chapterId, chapterId));

    return results.map(
      (r) =>
        new ChatChannel(
          r.id,
          r.chapterId,
          r.name,
          r.description,
          r.type as 'PUBLIC' | 'PRIVATE' | 'ROLE_GATED',
          r.allowedRoleIds,
          r.createdAt,
        ),
    );
  }

  async createMessage(
    message: Omit<ChatMessage, 'id' | 'createdAt'>,
  ): Promise<ChatMessage> {
    const [result] = await this.db
      .insert(schema.chatMessages)
      .values({
        channelId: message.channelId,
        senderId: message.senderId,
        content: message.content,
        metadata: message.metadata,
      })
      .returning();

    return new ChatMessage(
      result.id,
      result.channelId,
      result.senderId,
      result.content,
      result.metadata as Record<string, unknown> | null,
      result.createdAt,
    );
  }

  async findMessagesByChannel(
    channelId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<ChatMessage[]> {
    const results = await this.db
      .select()
      .from(schema.chatMessages)
      .where(eq(schema.chatMessages.channelId, channelId))
      .orderBy(desc(schema.chatMessages.createdAt))
      .limit(limit)
      .offset(offset);

    return results.map(
      (r) =>
        new ChatMessage(
          r.id,
          r.channelId,
          r.senderId,
          r.content,
          r.metadata as Record<string, unknown> | null,
          r.createdAt,
        ),
    );
  }
}
