import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  STORAGE_PROVIDER,
  type IStorageProvider,
} from '#domain/adapters/storage.interface';
import {
  PROFILES_BUCKET,
  ownProfilePhotoPath,
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

/** Bound on the reuse cache; the least recently used entry goes first past it. */
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
 * A profile-photo path in the row owner's **own** folder is signed. Anything
 * else serves as `null`, so the client draws initials. That covers every value
 * the free-text `PATCH /v1/users/me` could store before it stopped accepting
 * `avatar_url` (#2519): a path into someone else's folder, which would hand out
 * a photo the owner never uploaded, and a URL. No code has ever written a URL
 * here (sign-in syncs only the email and name), so a URL can only be one a
 * member typed in, and serving it would have every chapter-mate who opens a
 * chat with them fetch it from a host that member chose.
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
  /** Least recently used first: a hit moves its entry to the end. */
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
    const paths = rows.map((row) =>
      ownProfilePhotoPath(row.avatar_url, ownerOf(row)),
    );

    // Resolved into a local map before anything is evicted, so trimming the
    // cache below can never drop a URL this call is about to hand out.
    const resolved = new Map<string, string>();
    const toSign: string[] = [];
    for (const path of new Set(paths)) {
      if (!path) continue;
      const cached = this.cache.get(path);
      if (cached && cached.until > now) {
        resolved.set(path, cached.url);
        this.cache.delete(path);
        this.cache.set(path, cached);
      } else {
        toSign.push(path);
      }
    }

    if (toSign.length > 0) {
      const signed = await this.sign(toSign);
      for (const path of toSign) {
        const url = signed?.[path];
        if (url) {
          resolved.set(path, url);
          this.cache.delete(path);
          this.cache.set(path, { url, until: now + REUSE_WINDOW_MS });
        } else {
          // Past its reuse window an entry is still served when re-signing
          // just failed, while it has at least a minute left to live.
          const stale = this.cache.get(path);
          if (stale && now < stale.until + REUSE_WINDOW_MS - 60_000) {
            resolved.set(path, stale.url);
          }
        }
      }
      this.trim();
    }

    return rows.map((row, index) => {
      const path = paths[index];
      return { ...row, avatar_url: path ? (resolved.get(path) ?? null) : null };
    });
  }

  private async sign(paths: string[]): Promise<Record<string, string> | null> {
    try {
      return await this.storageProvider.getSignedDownloadUrls(
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
      return null;
    }
  }

  /** Drop the least recently used entries past the bound. */
  private trim(): void {
    while (this.cache.size > MAX_CACHED_URLS) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
