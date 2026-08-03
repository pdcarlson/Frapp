import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.provider';
import type { IStorageProvider } from '../../domain/adapters/storage.interface';

@Injectable()
export class SupabaseStorageService implements IStorageProvider {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async getSignedUploadUrl(
    bucket: string,
    path: string,
    contentType: string,
  ): Promise<string> {
    void contentType;
    const { data, error } = await this.supabase.storage
      .from(bucket)
      .createSignedUploadUrl(path);

    if (error) throw error;
    return data.signedUrl;
  }

  async getSignedDownloadUrl(
    bucket: string,
    path: string,
    expiresIn = 3600,
  ): Promise<string> {
    const { data, error } = await this.supabase.storage
      .from(bucket)
      .createSignedUrl(path, expiresIn);

    if (error) throw error;
    return data.signedUrl;
  }

  async deleteFile(bucket: string, path: string): Promise<void> {
    const { error } = await this.supabase.storage.from(bucket).remove([path]);
    if (error) throw error;
  }

  async listFiles(bucket: string, prefix: string): Promise<string[]> {
    // `list` returns names relative to the prefix and only for the immediate
    // folder level — enough for the flat `<prefix>/<filename>` layouts this
    // codebase uses (e.g. avatar uploads). 1000 covers any realistic folder.
    const { data, error } = await this.supabase.storage
      .from(bucket)
      .list(prefix, { limit: 1000 });
    if (error) throw error;
    return (data ?? [])
      .filter((entry) => entry.id !== null) // folders come back with id: null
      .map((entry) => `${prefix}/${entry.name}`);
  }
}
