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
 * One row of a storage `list()` response — an object, or a virtual folder.
 *
 * Derived from the client rather than imported from `@supabase/storage-js`,
 * whose type entry point has moved between versions; this follows whatever
 * the installed client actually returns.
 */
type StorageListEntry = NonNullable<
  Awaited<
    ReturnType<ReturnType<SupabaseClient['storage']['from']>['list']>
  >['data']
>[number];

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
    // Folders come back with `id: null` and carry no object metadata.
    return (await this.listEntries(bucket, prefix))
      .filter((entry) => entry.id !== null)
      .map((entry) => ({
        path: `${prefix}/${entry.name}`,
        createdAt: parseTimestamp(entry.created_at),
      }));
  }

  async listFolders(bucket: string, prefix: string): Promise<string[]> {
    return (await this.listEntries(bucket, prefix))
      .filter((entry) => entry.id === null)
      .map((entry) => entry.name);
  }

  /**
   * One page-exhausted `list` call, objects and folders both.
   *
   * `list` returns names relative to the prefix and only for the immediate
   * folder level — enough for the flat `<prefix>/<filename>` layouts this
   * codebase uses (e.g. avatar uploads). Paginate until exhausted so a folder
   * beyond one page is never silently truncated.
   *
   * The offset advances by the number of rows actually returned, and paging
   * stops only on an empty page — never on a short one. A short-page
   * termination silently truncates the moment the backend returns fewer rows
   * than asked for, which it is free to do: `limit` is a ceiling, not a
   * promise, and a server-side cap below `pageSize` would make *every* first
   * page read as "end of results". `SWEEP_PAGE_SIZE` in
   * `scheduled-jobs.repository.ts` documents the same hazard for PostgREST;
   * here the pattern costs one extra empty request per prefix and removes the
   * assumption entirely. That matters most for the purges: a truncated list
   * means a silent partial delete reported as complete erasure.
   */
  private async listEntries(
    bucket: string,
    prefix: string,
  ): Promise<StorageListEntry[]> {
    assertSafePrefix(prefix);
    const pageSize = 1000;
    const all: StorageListEntry[] = [];
    for (let offset = 0; ; ) {
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
      if (entries.length === 0) return all;
      all.push(...entries);
      offset += entries.length;
    }
  }
}
