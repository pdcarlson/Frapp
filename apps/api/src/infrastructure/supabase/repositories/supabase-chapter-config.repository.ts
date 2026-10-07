import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type {
  ChapterWorkflowOverride,
  IChapterConfigRepository,
} from '#domain/repositories/chapter-config.repository.interface';
import type { ChapterWorkflow } from '#domain/entities/chapter-workflow.entity';
import {
  DUES_CONFIG_FIELDS,
  type DuesConfig,
} from '#domain/entities/chapter-dues-config.entity';
import {
  SERVICE_CONFIG_FIELDS,
  type ServiceConfig,
} from '#domain/entities/chapter-service-config.entity';
import {
  POINTS_CONFIG_FIELDS,
  type PointsConfig,
} from '#domain/entities/chapter-points-config.entity';
import { SupabaseQueryError } from '../supabase-query-error';

const DUES_SELECT = DUES_CONFIG_FIELDS.join(', ');
const SERVICE_SELECT = SERVICE_CONFIG_FIELDS.join(', ');
const POINTS_SELECT = POINTS_CONFIG_FIELDS.join(', ');

@Injectable()
export class SupabaseChapterConfigRepository implements IChapterConfigRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findWorkflows(chapterId: string): Promise<ChapterWorkflowOverride[]> {
    const { data, error } = await this.supabase
      .from('chapter_workflows')
      .select('key, enabled, threshold')
      .eq('chapter_id', chapterId);
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async findWorkflow(
    chapterId: string,
    key: string,
  ): Promise<Pick<ChapterWorkflow, 'enabled' | 'threshold'> | null> {
    const { data, error } = await this.supabase
      .from('chapter_workflows')
      .select('enabled, threshold')
      .eq('chapter_id', chapterId)
      .eq('key', key)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async upsertWorkflows(
    rows: TablesInsert<'chapter_workflows'>[],
  ): Promise<void> {
    const { error } = await this.supabase
      .from('chapter_workflows')
      .upsert(rows, { onConflict: 'chapter_id,key' });
    if (error) throw new SupabaseQueryError(error);
  }

  // The selects below are built from a joined field list, which supabase-js
  // cannot parse into a row type, so each read states the projection it asked
  // for. The list and the type come from the same domain constant.

  async findDuesConfig(chapterId: string): Promise<DuesConfig | null> {
    const { data, error } = await this.supabase
      .from('chapter_dues_config')
      .select(DUES_SELECT)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data as DuesConfig | null;
  }

  // `chapter_id` goes last in each upsert, not first: `config` comes from a
  // merge over a client-supplied partial, so spreading it over the scoped key
  // would let any future `chapter_id`-shaped addition to that type upsert onto
  // another chapter's row. No such key exists today; the order is what keeps
  // it from mattering if one is ever added.

  async upsertDuesConfig(chapterId: string, config: DuesConfig): Promise<void> {
    const row: TablesInsert<'chapter_dues_config'> = {
      ...config,
      chapter_id: chapterId,
    };
    const { error } = await this.supabase
      .from('chapter_dues_config')
      .upsert(row, { onConflict: 'chapter_id' });
    if (error) throw new SupabaseQueryError(error);
  }

  async findServiceConfig(chapterId: string): Promise<ServiceConfig | null> {
    const { data, error } = await this.supabase
      .from('chapter_service_config')
      .select(SERVICE_SELECT)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data as ServiceConfig | null;
  }

  async upsertServiceConfig(
    chapterId: string,
    config: ServiceConfig,
  ): Promise<void> {
    const row: TablesInsert<'chapter_service_config'> = {
      ...config,
      chapter_id: chapterId,
    };
    const { error } = await this.supabase
      .from('chapter_service_config')
      .upsert(row, { onConflict: 'chapter_id' });
    if (error) throw new SupabaseQueryError(error);
  }

  async findPointsConfig(chapterId: string): Promise<PointsConfig | null> {
    const { data, error } = await this.supabase
      .from('chapter_points_config')
      .select(POINTS_SELECT)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data as PointsConfig | null;
  }

  async upsertPointsConfig(
    chapterId: string,
    config: PointsConfig,
  ): Promise<void> {
    const row: TablesInsert<'chapter_points_config'> = {
      ...config,
      chapter_id: chapterId,
    };
    const { error } = await this.supabase
      .from('chapter_points_config')
      .upsert(row, { onConflict: 'chapter_id' });
    if (error) throw new SupabaseQueryError(error);
  }
}
