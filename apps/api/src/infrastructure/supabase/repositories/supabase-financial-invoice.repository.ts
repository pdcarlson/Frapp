import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import { IFinancialInvoiceRepository } from '#domain/repositories/financial-invoice.repository.interface';
import { FinancialInvoice } from '#domain/entities/financial-invoice.entity';

@Injectable()
export class SupabaseFinancialInvoiceRepository implements IFinancialInvoiceRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
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
    return data;
  }

  async findByChapter(chapterId: string): Promise<FinancialInvoice[]> {
    const { data, error } = await this.supabase
      .from('financial_invoices')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
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
    return data || [];
  }

  async findOverdue(
    chapterId: string,
    graceDays = 0,
  ): Promise<FinancialInvoice[]> {
    // Overdue = OPEN and past due_date + grace: due_date < today - graceDays.
    const cutoff = new Date(Date.now() - graceDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];
    const { data, error } = await this.supabase
      .from('financial_invoices')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('status', 'OPEN')
      .lt('due_date', cutoff)
      .order('due_date', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async create(
    data: TablesInsert<'financial_invoices'>,
  ): Promise<FinancialInvoice> {
    const { data: created, error } = await this.supabase
      .from('financial_invoices')
      .insert(data)
      .select()
      .single();
    if (error) throw error;
    return created;
  }

  async update(
    id: string,
    chapterId: string,
    data: TablesUpdate<'financial_invoices'>,
  ): Promise<FinancialInvoice> {
    const { data: updated, error } = await this.supabase
      .from('financial_invoices')
      .update(data)
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .select()
      .single();
    if (error) throw error;
    return updated;
  }

  async applyPayment(
    id: string,
    chapterId: string,
    paymentIntentId: string | null,
    chargeId: string | null,
  ): Promise<FinancialInvoice | null> {
    const { data, error } = await this.supabase.rpc('apply_invoice_payment', {
      p_invoice_id: id,
      p_chapter_id: chapterId,
      p_payment_intent_id: paymentIntentId,
      p_charge_id: chargeId,
    });
    if (error) throw error;
    const rows = data ?? [];
    return rows.length > 0 ? rows[0] : null;
  }

  async setPaymentIntentIfOpen(
    id: string,
    chapterId: string,
    paymentIntentId: string,
  ): Promise<FinancialInvoice | null> {
    const { data, error } = await this.supabase
      .from('financial_invoices')
      .update({
        stripe_payment_intent_id: paymentIntentId,
      } satisfies TablesUpdate<'financial_invoices'>)
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .eq('status', 'OPEN')
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  }
}
