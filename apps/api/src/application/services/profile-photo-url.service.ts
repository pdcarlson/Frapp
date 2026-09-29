import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  STORAGE_PROVIDER,
  type IStorageProvider,
} from '#domain/adapters/storage.interface';
import {
  PROFILES_BUCKET,
  parseProfilePhotoPath,
} from '#domain/constants/storage';

/**
 * Signed-download-URL lifetime for a profile photo, in seconds. One hour, the
 * same as chat attachments and imported authors' avatars.
 */
const PROFILE_PHOTO_URL_TTL_SECONDS = 3600;

/**
 * How long a signed URL is handed out again before a fresh one is minted.
 * Half the TTL, so a URL a client caches for the life of a query is never
 * handed over with less than half an hour left.
 */
const REUSE_WINDOW_MS = (PROFILE_PHOTO_URL_TTL_SECONDS * 1000) / 2;

/** Bound on the reuse cache; the oldest entry goes first past it. */
const MAX_CACHED_URLS = 5000;

/** Anything carrying the stored `users.avatar_url` value. */
interface HasAvatarUrl {
  avatar_url: string | null;
}

/**
 * Turns the stored `users.avatar_url` into something an `<img>` can load.
 *
 * The `profiles` bucket is private (`spec/architecture/README.md` § 7), so the
 * bare storage path a confirmed upload stores renders nothing on its own. Every
 * route that serves `avatar_url` passes its rows through here, the way
 * `ChapterService.findByIdWithLogoUrl` signs `logo_path`.
 *
 * Per value:
 *
 * - a profile-photo path inside the row owner's **own** folder is signed;
 * - an `https:` URL passes through (a provider avatar written before uploads
 *   existed);
 * - anything else serves as `null`, so the client draws initials. That covers
 *   a path into someone else's folder, which `PATCH /v1/users/me` could store
 *   before it stopped accepting `avatar_url` (#2519). Signing it would hand
 *   out a photo the row's owner never uploaded.
 *
 * A signing failure degrades to `null` for the affected rows rather than
 * failing the read: a photo is decoration on a roster, a directory, or the
 * caller's own profile.
 *
 * ## Why URLs are reused
 *
 * A signed URL embeds its issue time, so signing afresh on every read hands the
 * client a new `src` for the same photo on every refetch. The browser treats
 * each one as a new image and downloads it again, and the chat roster refetches
 * often. So a URL is reused for half its lifetime. The cache is per process,
 * which is fine: a miss costs only a re-download.
 */
@Injectable()
export class ProfilePhotoUrlService {
  private readonly logger = new Logger(ProfilePhotoUrlService.name);
  private readonly cache = new Map<string, { url: string; until: number }>();

  constructor(
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: IStorageProvider,
  ) {}

  /** {@link signRows} for one row. */
  async signRow<T extends HasAvatarUrl>(row: T, ownerId: string): Promise<T> {
    const [signed] = await this.signRows([row], () => ownerId);
    return signed;
  }

  /**
   * Returns copies of `rows` with `avatar_url` replaced by what a client can
   * render. `ownerOf` names the `users.id` each row's photo belongs to.
   */
  async signRows<T extends HasAvatarUrl>(
    rows: readonly T[],
    ownerOf: (row: T) => string,
  ): Promise<T[]> {
    const now = Date.now();
    const toSign = new Set<string>();
    const planned = rows.map((row) => {
      const value = row.avatar_url;
      if (!value) return { kind: 'none' as const };
      if (/^https:\/\//i.test(value)) return { kind: 'url' as const, value };
      const parsed = parseProfilePhotoPath(value);
      if (!parsed || parsed.userId !== ownerOf(row)) {
        return { kind: 'none' as const };
      }
      const cached = this.cache.get(value);
      if (!cached || cached.until <= now) toSign.add(value);
      return { kind: 'path' as const, value };
    });

    if (toSign.size > 0) await this.signAndCache([...toSign], now);

    return rows.map((row, index) => {
      const plan = planned[index];
      const avatar_url =
        plan.kind === 'url'
          ? plan.value
          : plan.kind === 'path'
            ? this.liveUrl(plan.value, now)
            : null;
      return { ...row, avatar_url };
    });
  }

  /**
   * The cached URL while it still has at least a minute to live. Past its
   * reuse window an entry is only served when re-signing it just failed.
   */
  private liveUrl(path: string, now: number): string | null {
    const entry = this.cache.get(path);
    if (!entry) return null;
    const expiresAt = entry.until + REUSE_WINDOW_MS;
    return now < expiresAt - 60_000 ? entry.url : null;
  }

  private async signAndCache(paths: string[], now: number): Promise<void> {
    let signed: Record<string, string>;
    try {
      signed = await this.storageProvider.getSignedDownloadUrls(
        PROFILES_BUCKET,
        paths,
        PROFILE_PHOTO_URL_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(
        `Could not sign ${paths.length} profile photo(s); serving initials: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      // An entry past its reuse window may still be inside its TTL, and
      // `liveUrl` serves it if so: better than serving nothing.
      return;
    }
    for (const path of paths) {
      const url = signed[path];
      if (!url) continue;
      this.cache.delete(path);
      this.cache.set(path, { url, until: now + REUSE_WINDOW_MS });
    }
    while (this.cache.size > MAX_CACHED_URLS) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
