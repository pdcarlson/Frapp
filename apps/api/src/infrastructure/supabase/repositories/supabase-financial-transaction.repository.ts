import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase.provider';
import { IFinancialTransactionRepository } from '../../../domain/repositories/financial-transaction.repository.interface';
import { FinancialTransaction } from '../../../domain/entities/financial-transaction.entity';

@Injectable()
export class SupabaseFinancialTransactionRepository
  implements IFinancialTransactionRepository
{
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findByChapter(chapterId: string): Promise<FinancialTransaction[]> {
    const { data, error } = await this.supabase
      .from('financial_transactions')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data as FinancialTransaction[]) || [];
  }

  async findByInvoice(invoiceId: string): Promise<FinancialTransaction[]> {
    const { data, error } = await this.supabase
      .from('financial_transactions')
      .select('*')
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data as FinancialTransaction[]) || [];
  }

  async create(
    data: Partial<FinancialTransaction>,
  ): Promise<FinancialTransaction> {
    const { data: created, error } = await this.supabase
      .from('financial_transactions')
      .insert(data)
      .select()
      .single();
    if (error) throw error;
    return created as FinancialTransaction;
  }
}
