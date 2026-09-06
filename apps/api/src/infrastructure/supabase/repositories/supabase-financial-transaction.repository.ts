import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import { IFinancialTransactionRepository } from '#domain/repositories/financial-transaction.repository.interface';
import { FinancialTransaction } from '#domain/entities/financial-transaction.entity';

@Injectable()
export class SupabaseFinancialTransactionRepository implements IFinancialTransactionRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findByInvoice(invoiceId: string): Promise<FinancialTransaction[]> {
    const { data, error } = await this.supabase
      .from('financial_transactions')
      .select('*')
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async create(
    data: TablesInsert<'financial_transactions'>,
  ): Promise<FinancialTransaction> {
    const { data: created, error } = await this.supabase
      .from('financial_transactions')
      .insert(data)
      .select()
      .single();
    if (error) throw error;
    return created;
  }
}
