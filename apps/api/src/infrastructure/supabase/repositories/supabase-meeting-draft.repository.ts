import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import type {
  IMeetingDraftRepository,
  MeetingDraftOutcome,
  NewMeetingDraft,
} from '#domain/repositories/meeting-draft.repository.interface';
import type {
  MeetingDraft,
  MeetingDraftRowStatus,
} from '#domain/entities/meeting.entity';
import { SupabaseQueryError } from '../supabase-query-error';

@Injectable()
export class SupabaseMeetingDraftRepository implements IMeetingDraftRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async find(
    chapterId: string,
    meetingId: string,
  ): Promise<MeetingDraft | null> {
    const { data, error } = await this.supabase
      .from('meeting_drafts')
      .select('*')
      .eq('meeting_id', meetingId)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async replace(data: NewMeetingDraft): Promise<MeetingDraft> {
    // Every column is written, so nothing of the earlier request survives.
    const row: TablesInsert<'meeting_drafts'> = {
      ...data,
      run_id: null,
      status: 'drafting',
      failure_code: null,
      result: null,
      requested_at: new Date().toISOString(),
      finished_at: null,
    };
    const { data: saved, error } = await this.supabase
      .from('meeting_drafts')
      .upsert(row, { onConflict: 'meeting_id' })
      .select()
      .single();
    if (error) throw new SupabaseQueryError(error);
    return saved;
  }

  async setRun(
    chapterId: string,
    meetingId: string,
    requestId: string,
    runId: string,
  ): Promise<void> {
    const patch: TablesUpdate<'meeting_drafts'> = { run_id: runId };
    const { error } = await this.supabase
      .from('meeting_drafts')
      .update(patch)
      .eq('meeting_id', meetingId)
      .eq('chapter_id', chapterId)
      .eq('request_id', requestId);
    if (error) throw new SupabaseQueryError(error);
  }

  async finish(
    chapterId: string,
    meetingId: string,
    requestId: string,
    from: readonly MeetingDraftRowStatus[],
    outcome: MeetingDraftOutcome,
  ): Promise<MeetingDraft | null> {
    const patch: TablesUpdate<'meeting_drafts'> = {
      status: outcome.status,
      finished_at: new Date().toISOString(),
      ...(outcome.failure_code === undefined
        ? {}
        : { failure_code: outcome.failure_code }),
      ...(outcome.result === undefined ? {} : { result: outcome.result }),
    };
    const { data, error } = await this.supabase
      .from('meeting_drafts')
      .update(patch)
      .eq('meeting_id', meetingId)
      .eq('chapter_id', chapterId)
      .eq('request_id', requestId)
      .in('status', [...from])
      .select()
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async delete(chapterId: string, meetingId: string): Promise<void> {
    const { error } = await this.supabase
      .from('meeting_drafts')
      .delete()
      .eq('meeting_id', meetingId)
      .eq('chapter_id', chapterId);
    if (error) throw new SupabaseQueryError(error);
  }

  async deleteRequestedBefore(cutoff: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('meeting_drafts')
      .delete()
      .lt('requested_at', cutoff)
      .select('meeting_id');
    if (error) throw new SupabaseQueryError(error);
    return data?.length ?? 0;
  }
}
