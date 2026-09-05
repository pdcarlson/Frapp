import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import type { IChatCategoryRepository } from '../../../domain/repositories/chat.repository.interface';
import { ChatChannelCategory } from '../../../domain/entities/chat.entity';

@Injectable()
export class SupabaseChatCategoryRepository implements IChatCategoryRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  /**
   * Categories for one chapter, in the order they should render.
   *
   * **`created_at` is a tie-break, not decoration.** `display_order` is
   * `int not null default 0` with no unique constraint, and nothing enforces
   * distinct values: the admin screen computes `max + 1` from a list it caches
   * for 60s, so two admins creating a category inside that window both land on
   * the same number, and `UpdateCategoryDto.display_order` accepts an arbitrary
   * value with no uniqueness check either. Ordering on `display_order` alone
   * therefore leaves tied rows in whatever order Postgres happens to return,
   * which is not stable between queries.
   *
   * That used to surface only on the admin screen. The web chat rail now groups
   * the member-facing channel list by these rows and takes this order as
   * authoritative rather than re-sorting, so an unstable tie would visibly
   * shuffle a member's sidebar between refetches with no data change.
   */
  async findByChapter(chapterId: string): Promise<ChatChannelCategory[]> {
    const { data, error } = await this.supabase
      .from('chat_channel_categories')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async create(
    data: TablesInsert<'chat_channel_categories'>,
  ): Promise<ChatChannelCategory> {
    const { data: created, error } = await this.supabase
      .from('chat_channel_categories')
      .insert(data)
      .select()
      .single();
    if (error) throw error;
    return created;
  }

  async findById(
    id: string,
    chapterId: string,
  ): Promise<ChatChannelCategory | null> {
    const { data, error } = await this.supabase
      .from('chat_channel_categories')
      .select('*')
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async update(
    id: string,
    chapterId: string,
    data: TablesUpdate<'chat_channel_categories'>,
  ): Promise<ChatChannelCategory> {
    const { data: updated, error } = await this.supabase
      .from('chat_channel_categories')
      .update(data)
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .select()
      .single();
    if (error) throw error;
    return updated;
  }

  async delete(id: string, chapterId: string): Promise<void> {
    const { error } = await this.supabase
      .from('chat_channel_categories')
      .delete()
      .eq('id', id)
      .eq('chapter_id', chapterId);
    if (error) throw error;
  }
}
