import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import type {
  IChapterDocumentRepository,
  ChapterDocumentFilter,
} from '#domain/repositories/chapter-document.repository.interface';
import type { ChapterDocument } from '#domain/entities/chapter-document.entity';
import { escapeLikePattern } from '../supabase.utils';
import { SupabaseQueryError } from '../supabase-query-error';
import { PG_UNIQUE_VIOLATION } from '#domain/constants/postgres-error-codes';

@Injectable()
export class SupabaseChapterDocumentRepository implements IChapterDocumentRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findById(
    id: string,
    chapterId: string,
  ): Promise<ChapterDocument | null> {
    const { data, error } = await this.supabase
      .from('chapter_documents')
      .select('*')
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async findByChapter(
    chapterId: string,
    filter?: ChapterDocumentFilter,
  ): Promise<ChapterDocument[]> {
    let query = this.supabase
      .from('chapter_documents')
      .select('*')
      .eq('chapter_id', chapterId);

    if (filter?.folder !== undefined) {
      if (filter.folder === null) {
        query = query.is('folder', null);
      } else {
        query = query.eq('folder', filter.folder);
      }
    }

    if (filter?.search) {
      query = query.ilike('title', `%${escapeLikePattern(filter.search)}%`);
    }

    const { data, error } = await query.order('created_at', {
      ascending: false,
    });
    if (error) throw new SupabaseQueryError(error);
    return data || [];
  }

  /**
   * Insert, and translate a hit on `chapter_documents_storage_path_key` into
   * "here is the row that already files this object" (#3399).
   *
   * A confirm whose response was lost after it committed is retried with the
   * same `storage_path` (mobile's upload sheet keeps the bytes it sent rather
   * than uploading a second copy). The insert names no id, and the path index
   * is the only other unique key on the table, so a `23505` here means this
   * path is filed. The re-select is scoped to the chapter. A null re-select
   * means that row was deleted between the failed insert and the read, and
   * surfacing the original error is the honest answer. Whether the caller may
   * have the row is the service's call (`ChapterDocumentService.confirmUpload`),
   * which reads the path first, so this re-read serves only two confirms that
   * race past that read.
   */
  async create(
    data: TablesInsert<'chapter_documents'>,
  ): Promise<ChapterDocument> {
    const { data: created, error } = await this.supabase
      .from('chapter_documents')
      .insert(data)
      .select()
      .single();
    if (error) {
      if (
        error.code === PG_UNIQUE_VIOLATION &&
        data.storage_path &&
        data.chapter_id
      ) {
        const filed = await this.findByStoragePath(
          data.storage_path,
          data.chapter_id,
        );
        if (filed) return filed;
      }
      throw new SupabaseQueryError(error);
    }
    return created;
  }

  async findByStoragePath(
    storagePath: string,
    chapterId: string,
  ): Promise<ChapterDocument | null> {
    const { data, error } = await this.supabase
      .from('chapter_documents')
      .select('*')
      .eq('storage_path', storagePath)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async delete(id: string, chapterId: string): Promise<void> {
    const { error } = await this.supabase
      .from('chapter_documents')
      .delete()
      .eq('id', id)
      .eq('chapter_id', chapterId);
    if (error) throw new SupabaseQueryError(error);
  }

  async moveToRoot(folder: string, chapterId: string): Promise<void> {
    const patch: TablesUpdate<'chapter_documents'> = { folder: null };
    const { error } = await this.supabase
      .from('chapter_documents')
      .update(patch)
      .eq('chapter_id', chapterId)
      .eq('folder', folder);
    if (error) throw new SupabaseQueryError(error);
  }

  async renameFolder(
    fromFolder: string,
    toFolder: string,
    chapterId: string,
  ): Promise<void> {
    const patch: TablesUpdate<'chapter_documents'> = { folder: toFolder };
    const { error } = await this.supabase
      .from('chapter_documents')
      .update(patch)
      .eq('chapter_id', chapterId)
      .eq('folder', fromFolder);
    if (error) throw new SupabaseQueryError(error);
  }
}
