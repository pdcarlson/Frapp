import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import { escapeFilterValue } from '../../infrastructure/supabase/supabase.utils';
import type { BackworkResource } from '../../domain/entities/backwork.entity';
import type { Event } from '../../domain/entities/event.entity';
import type { ChatMessage } from '../../domain/entities/chat.entity';

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

  async search(chapterId: string, query: string): Promise<SearchResult> {
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
        this.searchMessages(chapterId, pattern),
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
    pattern: string,
  ): Promise<ChatMessage[]> {
    const { data: channels, error: chError } = (await this.supabase
      .from('chat_channels')
      .select('id')
      .eq('chapter_id', chapterId)) as QueryResult<{ id: string }>;
    throwIfError(chError);
    if (!channels?.length) return [];

    const channelIds = channels.map((c) => c.id);
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
}
