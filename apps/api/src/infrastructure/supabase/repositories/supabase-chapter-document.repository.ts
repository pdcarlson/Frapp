import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import type {
  IChapterDocumentRepository,
  ChapterDocumentFilter,
} from '../../../domain/repositories/chapter-document.repository.interface';
import type { ChapterDocument } from '../../../domain/entities/chapter-document.entity';

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
    if (error) throw error;
    return data as ChapterDocument | null;
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

    const { data, error } = await query.order('created_at', {
      ascending: false,
    });
    if (error) throw error;
    return (data as ChapterDocument[]) || [];
  }

  async create(data: Partial<ChapterDocument>): Promise<ChapterDocument> {
    const { data: created, error } = await this.supabase
      .from('chapter_documents')
      .insert(data as never)
      .select()
      .single();
    if (error) throw error;
    return created as ChapterDocument;
  }

  async delete(id: string, chapterId: string): Promise<void> {
    const { error } = await this.supabase
      .from('chapter_documents')
      .delete()
      .eq('id', id)
      .eq('chapter_id', chapterId);
    if (error) throw error;
  }

  async moveToRoot(folder: string, chapterId: string): Promise<void> {
    const { error } = await this.supabase
      .from('chapter_documents')
      .update({ folder: null } as never)
      .eq('chapter_id', chapterId)
      .eq('folder', folder);
    if (error) throw error;
  }
}
