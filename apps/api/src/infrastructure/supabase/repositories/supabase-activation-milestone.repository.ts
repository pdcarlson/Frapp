import { Inject, Injectable } from '@nestjs/common';
import type { ActivationMilestone } from '@repo/validation';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type { IActivationMilestoneRepository } from '#domain/repositories/activation-milestone.repository.interface';

@Injectable()
export class SupabaseActivationMilestoneRepository implements IActivationMilestoneRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async recordFirst(
    chapterId: string,
    milestone: ActivationMilestone,
  ): Promise<boolean> {
    // `ignoreDuplicates: true` is `ON CONFLICT DO NOTHING`, and `RETURNING`
    // (the `.select()`) yields only rows the statement actually inserted. So an
    // empty result means someone got here first — which is the answer we want,
    // decided by the database in one atomic statement rather than by a
    // read-then-write this method could lose a race on.
    //
    // Deliberately not a plain `.insert()` + catch-23505: the conflict is the
    // *common* path here (every message after the first hits it), and routing
    // the common path through an exception makes it both slower and noisier in
    // logs than the branch it represents.
    const row: TablesInsert<'chapter_activation_milestones'> = {
      chapter_id: chapterId,
      milestone,
    };
    const { data, error } = await this.supabase
      .from('chapter_activation_milestones')
      .upsert(row, {
        onConflict: 'chapter_id,milestone',
        ignoreDuplicates: true,
      })
      .select('id');

    if (error) throw error;
    return (data ?? []).length > 0;
  }
}
