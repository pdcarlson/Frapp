import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { canAccessChannel } from '@repo/validation';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import { escapeFilterValue } from '../../infrastructure/supabase/supabase.utils';
import type { BackworkResource } from '../../domain/entities/backwork.entity';
import type { Event } from '../../domain/entities/event.entity';
import type {
  ChatMessage,
  ChannelType,
} from '../../domain/entities/chat.entity';

export interface SearchMemberResult {
  id: string;
  user_id: string;
  chapter_id: string;
  display_name: string;
  email: string;
}

export interface SearchResult {
  backwork: BackworkResource[];
  events: Event[];
  members: SearchMemberResult[];
  messages: ChatMessage[];
}

const SEARCH_LIMIT = 10;
const PATTERN = (q: string) => `%${q}%`;

interface QueryError {
  message: string;
}

interface QueryResult<T> {
  data: T[] | null;
  error: QueryError | null;
}

function throwIfError(error: QueryError | null): void {
  if (error) {
    throw new InternalServerErrorException(error.message);
  }
}

@Injectable()
export class SearchService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async search(
    chapterId: string,
    userId: string,
    query: string,
  ): Promise<SearchResult> {
    const q = query.trim();
    if (!q) {
      return { backwork: [], events: [], members: [], messages: [] };
    }

    const pattern = PATTERN(q);

    const [backworkRes, eventsRes, membersRes, messagesRes] = await Promise.all(
      [
        this.searchBackwork(chapterId, pattern),
        this.searchEvents(chapterId, pattern),
        this.searchMembers(chapterId, pattern),
        this.searchMessages(chapterId, userId, pattern),
      ],
    );

    return {
      backwork: backworkRes,
      events: eventsRes,
      members: membersRes,
      messages: messagesRes,
    };
  }

  private async searchBackwork(
    chapterId: string,
    pattern: string,
  ): Promise<BackworkResource[]> {
    const safePattern = escapeFilterValue(pattern);
    const { data, error } = (await this.supabase
      .from('backwork_resources')
      .select('*')
      .eq('chapter_id', chapterId)
      .or(`title.ilike.${safePattern},course_number.ilike.${safePattern}`)
      .limit(SEARCH_LIMIT)) as QueryResult<BackworkResource>;
    throwIfError(error);
    return data ?? [];
  }

  private async searchEvents(
    chapterId: string,
    pattern: string,
  ): Promise<Event[]> {
    const safePattern = escapeFilterValue(pattern);
    const { data, error } = (await this.supabase
      .from('events')
      .select('*')
      .eq('chapter_id', chapterId)
      .or(`name.ilike.${safePattern},description.ilike.${safePattern}`)
      .limit(SEARCH_LIMIT)) as QueryResult<Event>;
    throwIfError(error);
    return data ?? [];
  }

  private async searchMembers(
    chapterId: string,
    pattern: string,
  ): Promise<SearchMemberResult[]> {
    const { data: members, error: memError } = (await this.supabase
      .from('members')
      .select('id, user_id, chapter_id')
      .eq('chapter_id', chapterId)) as QueryResult<{
      id: string;
      user_id: string;
      chapter_id: string;
    }>;
    throwIfError(memError);
    if (!members?.length) return [];

    const userIds = members.map((m) => m.user_id);
    const { data: users, error: userError } = (await this.supabase
      .from('users')
      .select('id, display_name, email')
      .in('id', userIds)
      .ilike('display_name', pattern)) as QueryResult<{
      id: string;
      display_name: string;
      email: string;
    }>;
    throwIfError(userError);
    if (!users?.length) return [];

    const userMap = new Map(
      users.map((u) => [
        u.id,
        { display_name: u.display_name, email: u.email },
      ]),
    );
    const memberMap = new Map(members.map((m) => [m.user_id, m]));

    return users.map((u) => {
      const m = memberMap.get(u.id);
      return {
        id: m?.id ?? '',
        user_id: u.id,
        chapter_id: chapterId,
        display_name: userMap.get(u.id)?.display_name ?? '',
        email: userMap.get(u.id)?.email ?? '',
      };
    });
  }

  private async searchMessages(
    chapterId: string,
    userId: string,
    pattern: string,
  ): Promise<ChatMessage[]> {
    const channelIds = await this.accessibleChannelIds(chapterId, userId);
    if (!channelIds.length) return [];

    const { data, error } = (await this.supabase
      .from('chat_messages')
      .select('*')
      .in('channel_id', channelIds)
      .ilike('content', pattern)
      .eq('is_deleted', false)
      .limit(SEARCH_LIMIT)
      .order('created_at', { ascending: false })) as QueryResult<ChatMessage>;
    throwIfError(error);
    return data ?? [];
  }

  /**
   * Channel ids in the chapter the caller may read, decided by the shared
   * `canAccessChannel` predicate (same rule the chat history / send paths use).
   * Search must not become a side-channel that leaks private, DM, or
   * role-gated messages the caller cannot otherwise see.
   */
  private async accessibleChannelIds(
    chapterId: string,
    userId: string,
  ): Promise<string[]> {
    const { data: channels, error: chError } = (await this.supabase
      .from('chat_channels')
      .select('id, type, member_ids, required_permissions')
      .eq('chapter_id', chapterId)) as QueryResult<{
      id: string;
      type: ChannelType;
      member_ids: string[] | null;
      required_permissions: string[] | null;
    }>;
    throwIfError(chError);
    if (!channels?.length) return [];

    const { data: members, error: memError } = (await this.supabase
      .from('members')
      .select('role_ids')
      .eq('user_id', userId)
      .eq('chapter_id', chapterId)
      .limit(1)) as QueryResult<{ role_ids: string[] | null }>;
    throwIfError(memError);
    const member = members?.[0];
    if (!member) return [];

    const permissions = await this.effectivePermissions(member.role_ids ?? []);

    return channels
      .filter((channel) =>
        canAccessChannel({
          channel: {
            type: channel.type,
            member_ids: channel.member_ids,
            required_permissions: channel.required_permissions,
          },
          userId,
          isChapterMember: true,
          permissions,
        }),
      )
      .map((channel) => channel.id);
  }

  private async effectivePermissions(roleIds: string[]): Promise<string[]> {
    if (!roleIds.length) return [];
    const { data: roles, error } = (await this.supabase
      .from('roles')
      .select('permissions')
      .in('id', roleIds)) as QueryResult<{ permissions: string[] | null }>;
    throwIfError(error);
    const set = new Set<string>();
    for (const role of roles ?? []) {
      for (const permission of role.permissions ?? []) set.add(permission);
    }
    return Array.from(set);
  }
}
