import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import type { IStudyGeofenceRepository } from '../../../domain/repositories/study.repository.interface';
import type { StudyGeofence } from '../../../domain/entities/study.entity';

@Injectable()
export class SupabaseStudyGeofenceRepository implements IStudyGeofenceRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findById(id: string, chapterId: string): Promise<StudyGeofence | null> {
    const { data, error } = await this.supabase
      .from('study_geofences')
      .select('*')
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw error;
    return data as StudyGeofence | null;
  }

  async findByChapter(chapterId: string): Promise<StudyGeofence[]> {
    const { data, error } = await this.supabase
      .from('study_geofences')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data as StudyGeofence[]) || [];
  }

  async create(data: Partial<StudyGeofence>): Promise<StudyGeofence> {
    const { data: created, error } = await this.supabase
      .from('study_geofences')
      .insert(data as never)
      .select()
      .single();

    if (error) throw error;
    return created as StudyGeofence;
  }

  async update(
    id: string,
    chapterId: string,
    data: Partial<StudyGeofence>,
  ): Promise<StudyGeofence> {
    const { data: updated, error } = await this.supabase
      .from('study_geofences')
      .update(data as never)
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .select()
      .single();

    if (error) throw error;
    return updated as StudyGeofence;
  }

  async delete(id: string, chapterId: string): Promise<void> {
    const { error } = await this.supabase
      .from('study_geofences')
      .delete()
      .eq('id', id)
      .eq('chapter_id', chapterId);

    if (error) throw error;
  }
}
