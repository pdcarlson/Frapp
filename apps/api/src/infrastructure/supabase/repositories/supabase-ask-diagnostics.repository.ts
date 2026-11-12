import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import { SupabaseQueryError } from '../supabase-query-error';
import type { AskDiagnosticsWindow } from '#domain/entities/ask-diagnostics.entity';
import type { IAskDiagnosticsRepository } from '#domain/repositories/ask-diagnostics.repository.interface';

const WINDOW_SELECT = 'id, chapter_id, started_by, started_at, ends_at';
/** Postgres `unique_violation`: a window is already open somewhere. */
const UNIQUE_VIOLATION = '23505';
/** Postgres `foreign_key_violation`: the window (or the member) is gone. */
const FOREIGN_KEY_VIOLATION = '23503';

/**
 * `ai_diagnostics_windows` and `ai_diagnostics_exchanges` through the
 * service role (#4315, `20261112200000_ai_ask_diagnostics.sql`).
 *
 * Every window read and write is keyed by chapter. Two writes are not, on
 * purpose: a person's answer on the AI sheet covers every chapter, so a No
 * deletes what they asked everywhere (`deleteExchangesByUser`), and the
 * sweep deletes whatever has run out wherever it is (`deleteExpiredWindows`).
 *
 * A window's exchanges are deleted by the database with the window (a
 * cascade), so "off" and "nothing kept" are one statement and cannot come
 * apart. There is no method that reads an exchange.
 */
@Injectable()
export class SupabaseAskDiagnosticsRepository implements IAskDiagnosticsRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
  ) {}

  async findWindow(chapterId: string): Promise<AskDiagnosticsWindow | null> {
    const { data, error } = await this.supabase
      .from('ai_diagnostics_windows')
      .select(WINDOW_SELECT)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data ?? null;
  }

  async openWindow(input: {
    chapterId: string;
    startedBy: string;
    startedAt: Date;
    endsAt: Date;
  }): Promise<AskDiagnosticsWindow | null> {
    const row: TablesInsert<'ai_diagnostics_windows'> = {
      started_by: input.startedBy,
      started_at: input.startedAt.toISOString(),
      ends_at: input.endsAt.toISOString(),
      chapter_id: input.chapterId,
    };
    const { data, error } = await this.supabase
      .from('ai_diagnostics_windows')
      .insert(row)
      .select(WINDOW_SELECT)
      .single();
    if (error) {
      if (error.code === UNIQUE_VIOLATION) return null;
      throw new SupabaseQueryError(error);
    }
    return data;
  }

  async deleteWindow(chapterId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('ai_diagnostics_windows')
      .delete()
      .eq('chapter_id', chapterId)
      .select('id');
    if (error) throw new SupabaseQueryError(error);
    return (data?.length ?? 0) > 0;
  }

  async insertExchange(input: {
    chapterId: string;
    windowId: string;
    memberId: string;
    userId: string;
    sealed: string;
    createdAt: Date;
  }): Promise<boolean> {
    const row: TablesInsert<'ai_diagnostics_exchanges'> = {
      window_id: input.windowId,
      member_id: input.memberId,
      user_id: input.userId,
      sealed: input.sealed,
      created_at: input.createdAt.toISOString(),
      chapter_id: input.chapterId,
    };
    const { error } = await this.supabase
      .from('ai_diagnostics_exchanges')
      .insert(row);
    if (error) {
      // The window was turned off, or the member left, since they were read.
      if (error.code === FOREIGN_KEY_VIOLATION) return false;
      throw new SupabaseQueryError(error);
    }
    return true;
  }

  async deleteExchangesByUser(userId: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('ai_diagnostics_exchanges')
      .delete()
      .eq('user_id', userId)
      .select('id');
    if (error) throw new SupabaseQueryError(error);
    return data?.length ?? 0;
  }

  async deleteExpiredWindows(now: Date): Promise<number> {
    const { data, error } = await this.supabase
      .from('ai_diagnostics_windows')
      .delete()
      .lte('ends_at', now.toISOString())
      .select('id');
    if (error) throw new SupabaseQueryError(error);
    return data?.length ?? 0;
  }
}
