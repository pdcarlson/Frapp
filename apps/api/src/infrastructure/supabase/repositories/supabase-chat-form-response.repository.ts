import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import type { ChatFormResponse } from '#domain/entities/chat.entity';
import {
  FormResponseRefusedError,
  type IChatFormResponseRepository,
} from '#domain/repositories/chat-form-response.repository.interface';
import { SupabaseQueryError } from '../supabase-query-error';

/**
 * Members' answers to form cards (#3926 step 3).
 *
 * Every query but one filters on `user_id`. That filter is the privacy
 * boundary: the table enables RLS with no policies, and the API reaches it
 * through the service-role client, which bypasses RLS, so nothing but this
 * filter keeps one member's answers from another
 * (`SupabaseChapterDocumentStarRepository` is built the same way). The one
 * exception is `findAllForCreator` (#3926 step 4), which reads every member's
 * answers to a form and is safe only behind the sender check in
 * `ChatFormService.getResponses`. Never call it from anywhere else.
 */
@Injectable()
export class SupabaseChatFormResponseRepository implements IChatFormResponseRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findOwn(
    messageId: string,
    userId: string,
  ): Promise<ChatFormResponse | null> {
    const { data, error } = await this.supabase
      .from('chat_form_responses')
      .select('*')
      .eq('message_id', messageId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async findAllForCreator(messageId: string): Promise<ChatFormResponse[]> {
    // Not member-filtered: the creator check in `ChatFormService` is the
    // boundary for this one read.
    const { data, error } = await this.supabase
      .from('chat_form_responses')
      .select('*')
      .eq('message_id', messageId)
      .order('created_at', { ascending: true });
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async save(
    messageId: string,
    userId: string,
    answers: Record<string, string | string[]>,
  ): Promise<ChatFormResponse> {
    const { data, error } = await this.supabase.rpc('save_chat_form_response', {
      p_message_id: messageId,
      p_user_id: userId,
      p_answers: answers,
    });
    if (error) {
      // The RPC names each refusal in its message
      // (`20261113040011_chat_form_responses.sql`); anything else is a
      // failure.
      const reason = FORM_REFUSALS[error.message];
      if (reason) throw new FormResponseRefusedError(reason);
      throw new SupabaseQueryError(error);
    }
    if (!data) throw new Error('save_chat_form_response returned no row');
    return data;
  }
}

const FORM_REFUSALS: Record<string, FormResponseRefusedError['reason']> = {
  form_card_missing: 'missing',
  form_closed: 'closed',
};
