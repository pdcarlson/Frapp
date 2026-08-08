import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.provider';
import type {
  IStorageProvider,
  StorageObject,
} from '../../domain/adapters/storage.interface';
import { assertSafeStoragePath } from '../../domain/utils/storage-path';

/**
 * Reject object paths that can escape their bucket.
 *
 * Guarding here rather than only at each call site: this class is the single
 * chokepoint every storage operation passes through, and the paths it receives
 * come from database columns that were themselves populated from client input.
 * See `assertSafeStoragePath` for why a raw `..` check is not sufficient.
 */
const assertSafeObjectPath = (path: string): void =>
  assertSafeStoragePath(path);

/**
 * Same guard for folder prefixes, which — unlike object paths — may legitimately
 * be empty (the bucket root).
 */
function assertSafePrefix(prefix: string): void {
  if (prefix.length === 0) return;
  assertSafeObjectPath(prefix);
}

/**
 * Storage timestamps as a Date, or null when absent or unparseable.
 *
 * The listing is metadata the backend supplies, not something this codebase
 * writes, so an age-based caller must be able to tell "stored at T" from "no
 * idea when" — `new Date(undefined)` would hand it an Invalid Date that
 * silently compares false against every cutoff instead.
 */
function parseTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

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
    assertSafeObjectPath(path);
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
    downloadAs?: string,
  ): Promise<string> {
    assertSafeObjectPath(path);
    const { data, error } = await this.supabase.storage
      .from(bucket)
      .createSignedUrl(
        path,
        expiresIn,
        downloadAs ? { download: downloadAs } : undefined,
      );

    if (error) throw error;
    return data.signedUrl;
  }

  async uploadFile(
    bucket: string,
    path: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<void> {
    assertSafeObjectPath(path);
    const { error } = await this.supabase.storage
      .from(bucket)
      // upsert so a caller that derives a deterministic key can refresh it in
      // place rather than failing on a duplicate. Report exports do not rely on
      // this — they mint a fresh uuid per call, so they never collide.
      .upload(path, body, { contentType, upsert: true });

    if (error) throw error;
  }

  async downloadFile(bucket: string, path: string): Promise<Uint8Array | null> {
    assertSafeObjectPath(path);
    const { data, error } = await this.supabase.storage
      .from(bucket)
      .download(path);

    // A missing object is a normal outcome for optional assets — the caller
    // asked whether it exists by asking for it. Matched narrowly on *object*:
    // "Bucket not found" is a misconfiguration and an inaccessible object is
    // also reported as "Object not found", so a broad match would silently
    // turn an unprovisioned bucket into "no logo" with nothing in the logs.
    if (error) {
      if (/object not found/i.test(error.message)) return null;
      throw error;
    }
    if (!data) return null;
    return new Uint8Array(await data.arrayBuffer());
  }

  async deleteFile(bucket: string, path: string): Promise<void> {
    assertSafeObjectPath(path);
    const { error } = await this.supabase.storage.from(bucket).remove([path]);
    if (error) throw error;
  }

  async deleteFiles(bucket: string, paths: string[]): Promise<void> {
    paths.forEach(assertSafeObjectPath);
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
    const objects = await this.listObjects(bucket, prefix);
    return objects.map((object) => object.path);
  }

  async listObjects(bucket: string, prefix: string): Promise<StorageObject[]> {
    assertSafePrefix(prefix);
    // `list` returns names relative to the prefix and only for the immediate
    // folder level — enough for the flat `<prefix>/<filename>` layouts this
    // codebase uses (e.g. avatar uploads). Paginate until exhausted so a
    // folder beyond one page is never silently truncated.
    const pageSize = 1000;
    const objects: StorageObject[] = [];
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
      objects.push(
        ...entries
          .filter((entry) => entry.id !== null) // folders come back with id: null
          .map((entry) => ({
            path: `${prefix}/${entry.name}`,
            createdAt: parseTimestamp(entry.created_at),
          })),
      );
      if (entries.length < pageSize) return objects;
    }
  }
}
