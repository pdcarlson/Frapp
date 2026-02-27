import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase.provider';
import { IFinancialInvoiceRepository } from '../../../domain/repositories/financial-invoice.repository.interface';
import { FinancialInvoice } from '../../../domain/entities/financial-invoice.entity';

@Injectable()
export class SupabaseFinancialInvoiceRepository
  implements IFinancialInvoiceRepository
{
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findById(
    id: string,
    chapterId: string,
  ): Promise<FinancialInvoice | null> {
    const { data, error } = await this.supabase
      .from('financial_invoices')
      .select('*')
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw error;
    return data as FinancialInvoice | null;
  }

  async findByChapter(chapterId: string): Promise<FinancialInvoice[]> {
    const { data, error } = await this.supabase
      .from('financial_invoices')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data as FinancialInvoice[]) || [];
  }

  async findByUser(
    userId: string,
    chapterId: string,
  ): Promise<FinancialInvoice[]> {
    const { data, error } = await this.supabase
      .from('financial_invoices')
      .select('*')
      .eq('user_id', userId)
      .eq('chapter_id', chapterId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data as FinancialInvoice[]) || [];
  }

  async create(data: Partial<FinancialInvoice>): Promise<FinancialInvoice> {
    const { data: created, error } = await this.supabase
      .from('financial_invoices')
      .insert(data)
      .select()
      .single();
    if (error) throw error;
    return created as FinancialInvoice;
  }

  async update(
    id: string,
    chapterId: string,
    data: Partial<FinancialInvoice>,
  ): Promise<FinancialInvoice> {
    const { data: updated, error } = await this.supabase
      .from('financial_invoices')
      .update(data)
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .select()
      .single();
    if (error) throw error;
    return updated as FinancialInvoice;
  }
}
