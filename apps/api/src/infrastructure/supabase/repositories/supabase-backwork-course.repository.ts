import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import type { IBackworkCourseRepository } from '#domain/repositories/backwork.repository.interface';
import { BackworkCourse } from '#domain/entities/backwork.entity';
import { SupabaseQueryError } from '../supabase-query-error';

/** The database's `course_key`: the course number trimmed and lowercased. */
function courseKey(courseNumber: string): string {
  return courseNumber.trim().toLowerCase();
}

@Injectable()
export class SupabaseBackworkCourseRepository implements IBackworkCourseRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findByChapter(chapterId: string): Promise<BackworkCourse[]> {
    const { data, error } = await this.supabase
      .from('backwork_courses')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('course_key', { ascending: true });
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async findByDepartment(
    chapterId: string,
    departmentId: string,
  ): Promise<BackworkCourse[]> {
    const { data, error } = await this.supabase
      .from('backwork_courses')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('department_id', departmentId);
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async findByCourse(
    chapterId: string,
    departmentId: string,
    courseNumber: string,
  ): Promise<BackworkCourse | null> {
    const { data, error } = await this.supabase
      .from('backwork_courses')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('department_id', departmentId)
      .eq('course_key', courseKey(courseNumber))
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async findById(
    id: string,
    chapterId: string,
  ): Promise<BackworkCourse | null> {
    const { data, error } = await this.supabase
      .from('backwork_courses')
      .select('*')
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async create(
    data: TablesInsert<'backwork_courses'>,
  ): Promise<BackworkCourse> {
    const { data: created, error } = await this.supabase
      .from('backwork_courses')
      .insert(data)
      .select()
      .single();
    if (error) throw new SupabaseQueryError(error);
    return created;
  }

  async update(
    id: string,
    chapterId: string,
    data: TablesUpdate<'backwork_courses'>,
  ): Promise<BackworkCourse | null> {
    // `chapter_id` in the filter, so the write itself can't reach another
    // chapter's row; `maybeSingle` turns "no row" into `null` for a 404.
    const { data: updated, error } = await this.supabase
      .from('backwork_courses')
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .select()
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return updated;
  }

  async delete(id: string, chapterId: string): Promise<void> {
    const { error } = await this.supabase
      .from('backwork_courses')
      .delete()
      .eq('id', id)
      .eq('chapter_id', chapterId);
    if (error) throw new SupabaseQueryError(error);
  }
}
