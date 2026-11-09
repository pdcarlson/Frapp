import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesUpdate } from '../database.types';
import type {
  BackworkCourseWrite,
  IBackworkCourseRepository,
} from '#domain/repositories/backwork.repository.interface';
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

  async write(
    chapterId: string,
    edit: BackworkCourseWrite,
  ): Promise<BackworkCourse | null> {
    const { data, error } = await this.supabase.rpc('backwork_course_write', {
      p_chapter_id: chapterId,
      p_department_id: edit.departmentId,
      p_course_number: edit.courseNumber,
      p_set_name: edit.setName,
      p_name: edit.name,
      p_may_rename: edit.mayRename,
      p_add: edit.add,
      p_remove: edit.remove,
    });
    if (error) throw new SupabaseQueryError(error);
    // The function returns no row (all-null columns) when the department
    // isn't in this chapter.
    return data?.id ? data : null;
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
