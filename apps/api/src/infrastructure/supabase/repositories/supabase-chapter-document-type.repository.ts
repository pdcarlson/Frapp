import { Inject, Injectable } from '@nestjs/common';
import { documentTypeKey } from '@repo/validation';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type { IChapterDocumentTypeRepository } from '#domain/repositories/chapter-document-type.repository.interface';
import type { ChapterDocumentType } from '#domain/entities/chapter-document.entity';
import { PG_UNIQUE_VIOLATION } from '#domain/constants/postgres-error-codes';
import { SupabaseQueryError } from '../supabase-query-error';

/**
 * `chapter_document_types` (#3642). Names are matched by key
 * (`documentTypeKey`, the database's `document_type_key`), never with LIKE:
 * PostgREST reads `*` in a like pattern as a wildcard, and no escape stops it.
 */
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
    // A chapter has a few dozen types at most, so the key is compared here
    // rather than through a computed-column filter PostgREST can't express.
    const key = documentTypeKey(name);
    if (key === '') return null;
    const types = await this.findByChapter(chapterId);
    return types.find((type) => documentTypeKey(type.name) === key) ?? null;
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

  async setSortOrder(
    id: string,
    chapterId: string,
    sortOrder: number,
  ): Promise<ChapterDocumentType | undefined> {
    const { data, error } = await this.supabase
      .from('chapter_document_types')
      .update({ sort_order: sortOrder })
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .select()
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data ?? undefined;
  }

  async rename(
    chapterId: string,
    id: string,
    name: string,
  ): Promise<ChapterDocumentType | null | undefined> {
    const { data, error } = await this.supabase.rpc(
      'rename_chapter_document_type',
      { p_chapter_id: chapterId, p_type_id: id, p_name: name },
    );
    if (error) {
      if (error.code === PG_UNIQUE_VIOLATION) return null;
      throw new SupabaseQueryError(error);
    }
    return data?.[0] ?? undefined;
  }

  async deleteWithDocuments(chapterId: string, id: string): Promise<boolean> {
    const { data, error } = await this.supabase.rpc(
      'delete_chapter_document_type',
      { p_chapter_id: chapterId, p_type_id: id },
    );
    if (error) throw new SupabaseQueryError(error);
    return data === true;
  }
}
