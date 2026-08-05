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

  async uploadFile(
    bucket: string,
    path: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<void> {
    const { error } = await this.supabase.storage
      .from(bucket)
      // upsert so a retried export overwrites its own object instead of
      // failing on a duplicate key; paths already carry a unique suffix.
      .upload(path, body, { contentType, upsert: true });

    if (error) throw error;
  }

  async downloadFile(bucket: string, path: string): Promise<Uint8Array | null> {
    const { data, error } = await this.supabase.storage
      .from(bucket)
      .download(path);

    // A missing object is a normal outcome for optional assets — the caller
    // asked whether it exists by asking for it. Real failures still throw.
    if (error) {
      if (/not found|does not exist/i.test(error.message)) return null;
      throw error;
    }
    if (!data) return null;
    return new Uint8Array(await data.arrayBuffer());
  }

  async deleteFile(bucket: string, path: string): Promise<void> {
    const { error } = await this.supabase.storage.from(bucket).remove([path]);
    if (error) throw error;
  }

  async deleteFiles(bucket: string, paths: string[]): Promise<void> {
    // `remove` natively accepts a batch; chunk defensively so a pathological
    // folder cannot produce an oversized request.
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await this.supabase.storage
        .from(bucket)
        .remove(paths.slice(i, i + 100));
      if (error) throw error;
    }
  }

  async listFiles(bucket: string, prefix: string): Promise<string[]> {
    // `list` returns names relative to the prefix and only for the immediate
    // folder level — enough for the flat `<prefix>/<filename>` layouts this
    // codebase uses (e.g. avatar uploads). Paginate until exhausted so a
    // folder beyond one page is never silently truncated.
    const pageSize = 1000;
    const paths: string[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await this.supabase.storage
        .from(bucket)
        .list(prefix, { limit: pageSize, offset });
      // A bucket that does not exist holds no objects; environments that have
      // never provisioned it (fresh projects, previews) must behave like an
      // empty folder, not an outage — account deletion aborts on listing
      // errors and would otherwise be permanently blocked there. This cannot
      // mask a wrong-project misconfiguration: SUPABASE_URL serves database
      // and storage from the same project, so a client pointed at the wrong
      // one fails at the users query long before any storage call.
      if (error && /bucket not found/i.test(error.message)) return [];
      if (error) throw error;
      const entries = data ?? [];
      paths.push(
        ...entries
          .filter((entry) => entry.id !== null) // folders come back with id: null
          .map((entry) => `${prefix}/${entry.name}`),
      );
      if (entries.length < pageSize) return paths;
    }
  }
}
