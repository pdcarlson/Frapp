import { ConflictException, NotFoundException } from '@nestjs/common';
import type { IDiscordImportRepository } from '#domain/repositories/discord-import.repository.interface';
import type { DiscordImport } from '#domain/entities/discord-import.entity';
import type { DiscordOAuthService } from './discord-oauth.service';

/**
 * The checks the admin-facing Discord import services run before they touch
 * an import (#3271). Shared functions rather than a method on one of the
 * services, so `DiscordImportService`, `DiscordImportChannelMappingService`
 * and `DiscordImportRoleMappingService` refuse the same imports with the same
 * sentence.
 */

/**
 * The row alone, chapter-scoped by the repository. The progress counts are for
 * the admin's list; a stop or a delete must not wait on them, or fail when
 * they do.
 */
export async function loadImport(
  importRepo: IDiscordImportRepository,
  id: string,
  chapterId: string,
): Promise<DiscordImport> {
  const found = await importRepo.findById(id, chapterId);
  if (!found) throw new NotFoundException('Import not found');
  return found;
}

/** Statuses in which the admin may still change the import's inputs. */
export function assertImportMutable(job: DiscordImport): void {
  if (
    job.status !== 'draft' &&
    job.status !== 'failed' &&
    job.status !== 'ready'
  ) {
    throw new ConflictException(
      `This import is ${job.status} and can no longer be changed.`,
    );
  }
}

/**
 * The chapter's connected guild, re-resolved by `chapter_id` rather than
 * trusted from the job row, and refused when it is no longer the one the
 * import was created against: a bot import cannot be scanned or started
 * against a server the chapter has since disconnected or replaced.
 */
export async function requireBoundGuild(
  oauthService: DiscordOAuthService,
  job: DiscordImport,
  chapterId: string,
): Promise<string> {
  const guildId = await oauthService.requireGuildId(chapterId);
  if (job.guild_id && job.guild_id !== guildId) {
    throw new ConflictException(
      'This chapter is now connected to a different Discord server. Start a new import.',
    );
  }
  return guildId;
}
