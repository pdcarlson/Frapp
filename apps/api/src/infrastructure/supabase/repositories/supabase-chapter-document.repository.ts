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
import { escapeLikePattern, fetchAllPages } from '../supabase.utils';
import { SupabaseQueryError } from '../supabase-query-error';
import { PG_UNIQUE_VIOLATION } from '#domain/constants/postgres-error-codes';

/** Rows per page for the paged reads; a request size, not the server's cap. */
const PAGE_SIZE = 1000;

/**
 * An upload or a file added by its own link: anything but a copy from the
 * connected Drive folder (`drive_file_id` set, `drive_link_status` null).
 */
const NOT_A_FOLDER_COPY = 'drive_file_id.is.null,drive_link_status.not.is.null';

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

  async findByIds(
    ids: string[],
    chapterId: string,
  ): Promise<ChapterDocument[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.supabase
      .from('chapter_documents')
      .select('*')
      .in('id', ids)
      .eq('chapter_id', chapterId);
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  /**
   * Every document the filter matches, read in pages (#5585): one read was
   * cut at PostgREST's 1,000-row cap with no error, so a chapter past 1,000
   * files lost its oldest ones and its folders looked empty. Newest first,
   * then id, so the pages never overlap or skip a row.
   */
  async findByChapter(
    chapterId: string,
    filter?: ChapterDocumentFilter,
  ): Promise<ChapterDocument[]> {
    return fetchAllPages(
      (from, to) => {
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

        return query
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to);
      },
      { pageSize: PAGE_SIZE },
    );
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

  async setPinnedAt(
    id: string,
    chapterId: string,
    pinnedAt: string | null,
  ): Promise<ChapterDocument | null> {
    const { data, error } = await this.supabase
      .from('chapter_documents')
      .update({ pinned_at: pinnedAt })
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .select()
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async setWhoCanSee(
    id: string,
    chapterId: string,
    whoCanSee: string[] | null,
  ): Promise<ChapterDocument | null> {
    const { data, error } = await this.supabase
      .from('chapter_documents')
      .update({ who_can_see: whoCanSee })
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .select()
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

  // Paged (#5585): sync compares Drive's tree with these, so a list cut at
  // 1,000 rows would copy the missing ones again and leave them behind on
  // disconnect.
  async findDriveCopies(chapterId: string): Promise<ChapterDocument[]> {
    return fetchAllPages(
      (from, to) =>
        this.supabase
          .from('chapter_documents')
          .select('*')
          .eq('chapter_id', chapterId)
          .not('drive_file_id', 'is', null)
          .is('drive_link_status', null)
          .order('id', { ascending: true })
          .range(from, to),
      { pageSize: PAGE_SIZE },
    );
  }

  async findByDriveFileId(
    chapterId: string,
    driveFileId: string,
  ): Promise<ChapterDocument | null> {
    const { data, error } = await this.supabase
      .from('chapter_documents')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('drive_file_id', driveFileId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async findLinkedDriveFileIds(chapterId: string): Promise<Set<string>> {
    const rows = await fetchAllPages(
      (from, to) =>
        this.supabase
          .from('chapter_documents')
          .select('id, drive_file_id')
          .eq('chapter_id', chapterId)
          .not('drive_link_status', 'is', null)
          .order('id', { ascending: true })
          .range(from, to),
      { pageSize: PAGE_SIZE },
    );
    return new Set(
      rows
        .map((row) => row.drive_file_id)
        .filter((id): id is string => id !== null),
    );
  }

  /**
   * Renames or refiles one document (#5563). Never a Drive folder copy,
   * whose name and folder Drive owns: the filter refuses it even if a caller
   * forgets to, and the method answers `null`, as for a missing row.
   */
  async updateFiling(
    id: string,
    chapterId: string,
    patch: Pick<TablesUpdate<'chapter_documents'>, 'title' | 'folder'>,
  ): Promise<ChapterDocument | null> {
    const { data, error } = await this.supabase
      .from('chapter_documents')
      .update(patch)
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .or(NOT_A_FOLDER_COPY)
      .select('*')
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  /** Refiles many documents into `folder` at once; never a Drive folder copy. */
  async moveMany(
    ids: string[],
    chapterId: string,
    folder: string | null,
  ): Promise<ChapterDocument[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.supabase
      .from('chapter_documents')
      .update({ folder })
      .in('id', ids)
      .eq('chapter_id', chapterId)
      .or(NOT_A_FOLDER_COPY)
      .select('*');
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async updateDriveCopy(
    id: string,
    chapterId: string,
    patch: TablesUpdate<'chapter_documents'>,
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('chapter_documents')
      .update(patch)
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .not('drive_file_id', 'is', null)
      .select('id');
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []).length > 0;
  }
}
