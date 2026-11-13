import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import type { IChapterDocumentTypeRepository } from '#domain/repositories/chapter-document-type.repository.interface';
import type { ChapterDocumentType } from '#domain/entities/chapter-document.entity';
import { PG_UNIQUE_VIOLATION } from '#domain/constants/postgres-error-codes';
import { SupabaseQueryError } from '../supabase-query-error';
import { escapeLikePattern } from '../supabase.utils';

@Injectable()
export class SupabaseChapterDocumentTypeRepository implements IChapterDocumentTypeRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findByChapter(chapterId: string): Promise<ChapterDocumentType[]> {
    const { data, error } = await this.supabase
      .from('chapter_document_types')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async findById(
    id: string,
    chapterId: string,
  ): Promise<ChapterDocumentType | null> {
    const { data, error } = await this.supabase
      .from('chapter_document_types')
      .select('*')
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async findByName(
    chapterId: string,
    name: string,
  ): Promise<ChapterDocumentType | null> {
    // `ilike` with the pattern characters escaped is a case-insensitive
    // equality, which is what the unique index on lower(btrim(name)) holds.
    // Callers pass a trimmed name; stored names are trimmed by the service.
    const { data, error } = await this.supabase
      .from('chapter_document_types')
      .select('*')
      .eq('chapter_id', chapterId)
      .ilike('name', escapeLikePattern(name))
      .limit(1)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async create(data: {
    chapter_id: string;
    name: string;
    sort_order: number;
  }): Promise<ChapterDocumentType | null> {
    const row: TablesInsert<'chapter_document_types'> = data;
    const { data: created, error } = await this.supabase
      .from('chapter_document_types')
      .insert(row)
      .select()
      .single();
    if (error) {
      if (error.code === PG_UNIQUE_VIOLATION) return null;
      throw new SupabaseQueryError(error);
    }
    return created;
  }

  async update(
    id: string,
    chapterId: string,
    data: TablesUpdate<'chapter_document_types'>,
  ): Promise<ChapterDocumentType | null | undefined> {
    const { data: updated, error } = await this.supabase
      .from('chapter_document_types')
      .update(data)
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .select()
      .maybeSingle();
    if (error) {
      if (error.code === PG_UNIQUE_VIOLATION) return null;
      throw new SupabaseQueryError(error);
    }
    return updated ?? undefined;
  }

  async delete(id: string, chapterId: string): Promise<void> {
    const { error } = await this.supabase
      .from('chapter_document_types')
      .delete()
      .eq('id', id)
      .eq('chapter_id', chapterId);
    if (error) throw new SupabaseQueryError(error);
  }
}
