import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import type { IChapterDocumentFolderRepository } from '../../../domain/repositories/chapter-document-folder.repository.interface';
import type { ChapterDocumentFolder } from '../../../domain/entities/chapter-document.entity';

@Injectable()
export class SupabaseChapterDocumentFolderRepository implements IChapterDocumentFolderRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findByChapter(chapterId: string): Promise<ChapterDocumentFolder[]> {
    const { data, error } = await this.supabase
      .from('chapter_document_folders')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  async findById(
    id: string,
    chapterId: string,
  ): Promise<ChapterDocumentFolder | null> {
    const { data, error } = await this.supabase
      .from('chapter_document_folders')
      .select('*')
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async findByName(
    chapterId: string,
    name: string,
  ): Promise<ChapterDocumentFolder | null> {
    const { data, error } = await this.supabase
      .from('chapter_document_folders')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('name', name)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(data: {
    chapter_id: string;
    name: string;
    sort_order: number;
  }): Promise<ChapterDocumentFolder> {
    const row: TablesInsert<'chapter_document_folders'> = data;
    const { data: created, error } = await this.supabase
      .from('chapter_document_folders')
      .insert(row)
      .select()
      .single();
    if (error) throw error;
    return created;
  }

  async update(
    id: string,
    chapterId: string,
    data: TablesUpdate<'chapter_document_folders'>,
  ): Promise<ChapterDocumentFolder> {
    const { data: updated, error } = await this.supabase
      .from('chapter_document_folders')
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
      .from('chapter_document_folders')
      .delete()
      .eq('id', id)
      .eq('chapter_id', chapterId);
    if (error) throw error;
  }
}
