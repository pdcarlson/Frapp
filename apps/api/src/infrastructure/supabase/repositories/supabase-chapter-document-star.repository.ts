import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type { IChapterDocumentStarRepository } from '#domain/repositories/chapter-document-star.repository.interface';
import type {
  ChapterDocumentStar,
  ChapterDocumentStarTarget,
} from '#domain/entities/chapter-document.entity';
import { SupabaseQueryError } from '../supabase-query-error';

/**
 * Members' own stars on document folders and documents (#3934).
 *
 * Every query filters on `user_id` and `chapter_id`. The `user_id` filter is
 * the privacy boundary: the table enables RLS with no policies, and the API
 * reaches it through the service-role client, which bypasses RLS, so nothing
 * but this filter keeps one member's stars from another
 * (`SupabaseChatMessageBookmarkRepository` is built the same way).
 */
@Injectable()
export class SupabaseChapterDocumentStarRepository implements IChapterDocumentStarRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findByUser(
    userId: string,
    chapterId: string,
  ): Promise<ChapterDocumentStar[]> {
    const { data, error } = await this.supabase
      .from('chapter_document_stars')
      .select('*')
      .eq('user_id', userId)
      .eq('chapter_id', chapterId)
      .order('created_at', { ascending: true });
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  /**
   * An upsert on the matching unique constraint, ignoring a duplicate, so a
   * double tap or an offline retry is a no-op rather than a 409.
   */
  async add(
    userId: string,
    chapterId: string,
    target: ChapterDocumentStarTarget,
  ): Promise<void> {
    const row: TablesInsert<'chapter_document_stars'> = {
      user_id: userId,
      chapter_id: chapterId,
      folder_id: target.folder_id ?? null,
      document_id: target.document_id ?? null,
    };
    const { error } = await this.supabase
      .from('chapter_document_stars')
      .upsert(row, {
        onConflict:
          target.folder_id !== undefined
            ? 'user_id,folder_id'
            : 'user_id,document_id',
        ignoreDuplicates: true,
      });
    if (error) throw new SupabaseQueryError(error);
  }

  async remove(
    userId: string,
    chapterId: string,
    target: ChapterDocumentStarTarget,
  ): Promise<void> {
    const query = this.supabase
      .from('chapter_document_stars')
      .delete()
      .eq('user_id', userId)
      .eq('chapter_id', chapterId);
    const { error } = await (target.folder_id !== undefined
      ? query.eq('folder_id', target.folder_id)
      : query.eq('document_id', target.document_id));
    if (error) throw new SupabaseQueryError(error);
  }
}
