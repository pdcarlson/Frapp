import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import { PG_UNIQUE_VIOLATION } from '#domain/repositories/chat.repository.interface';
import type { IRushCandidateRepository } from '#domain/repositories/rush-candidate.repository.interface';
import type { RushCandidate } from '#domain/entities/rush-candidate.entity';

@Injectable()
export class SupabaseRushCandidateRepository implements IRushCandidateRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findById(id: string, chapterId: string): Promise<RushCandidate | null> {
    const { data, error } = await this.supabase
      .from('rush_candidates')
      .select('*')
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async findByNameKey(
    chapterId: string,
    nameKey: string,
  ): Promise<RushCandidate | null> {
    const { data, error } = await this.supabase
      .from('rush_candidates')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('name_key', nameKey)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(
    data: Omit<RushCandidate, 'id' | 'name_key' | 'created_at'> & {
      id?: string;
      created_at?: string;
    },
  ): Promise<RushCandidate> {
    const { data: created, error } = await this.supabase
      .from('rush_candidates')
      .insert({
        chapter_id: data.chapter_id,
        display_name: data.display_name,
        user_id: data.user_id,
        stage: data.stage,
        bid_status: data.bid_status,
        created_by: data.created_by,
        ...(data.id ? { id: data.id } : {}),
        ...(data.created_at ? { created_at: data.created_at } : {}),
      })
      .select()
      .single();
    if (error) throw error;
    return created;
  }

  async setBidExtended(id: string, chapterId: string): Promise<RushCandidate> {
    const { data, error } = await this.supabase
      .from('rush_candidates')
      .update({ bid_status: 'extended' })
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async insertVote(
    candidateId: string,
    chapterId: string,
    voterId: string,
  ): Promise<'inserted' | 'duplicate'> {
    const { error } = await this.supabase.from('rush_candidate_votes').insert({
      candidate_id: candidateId,
      chapter_id: chapterId,
      voter_id: voterId,
    });
    if (error) {
      if ((error as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        return 'duplicate';
      }
      throw error;
    }
    return 'inserted';
  }

  async countVotes(candidateId: string, chapterId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('rush_candidate_votes')
      .select('*', { count: 'exact', head: true })
      .eq('candidate_id', candidateId)
      .eq('chapter_id', chapterId);
    if (error) throw error;
    return count ?? 0;
  }

  async viewerHasVoted(
    candidateId: string,
    chapterId: string,
    voterId: string,
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('rush_candidate_votes')
      .select('voter_id')
      .eq('candidate_id', candidateId)
      .eq('chapter_id', chapterId)
      .eq('voter_id', voterId)
      .maybeSingle();
    if (error) throw error;
    return data != null;
  }
}
