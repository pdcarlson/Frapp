import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  GOOGLE_DRIVE_API,
  GOOGLE_DRIVE_FOLDER_MIME,
  GoogleDriveApiError,
  type IGoogleDriveApi,
} from '#domain/adapters/google-drive.interface';
import {
  CHAPTER_DRIVE_REPOSITORY,
  type IChapterDriveRepository,
} from '#domain/repositories/chapter-drive.repository.interface';
import type { ChapterDriveConnection } from '#domain/entities/chapter-drive-connection.entity';
import { isUniqueViolation } from '#domain/constants/postgres-error-codes';
import { ChapterDocumentService } from '../chapter-document.service';
import { toReportableError } from '../../../infrastructure/observability/reportable-error';

export interface GoogleDriveStatus {
  available: boolean;
  service_account_email: string | null;
  connection: {
    folder_id: string;
    folder_name: string;
    folder_url: string;
    status: 'active' | 'no_access';
    last_synced_at: string | null;
    synced_count: number;
    skipped_count: number;
    folders_left_out: number;
    syncing: boolean;
    who_can_see: string[] | null;
  } | null;
}

/**
 * Connecting a chapter's Google Drive folder to Documents (#5157;
 * `spec/behavior/chapter-docs.md` § Google Drive folder). The copying is
 * `GoogleDriveSyncService`'s, on the worker.
 */
@Injectable()
export class GoogleDriveService {
  constructor(
    @Inject(GOOGLE_DRIVE_API) private readonly drive: IGoogleDriveApi,
    @Inject(CHAPTER_DRIVE_REPOSITORY)
    private readonly connections: IChapterDriveRepository,
    private readonly documents: ChapterDocumentService,
  ) {}

  async status(
    chapterId: string,
    now = new Date(),
  ): Promise<GoogleDriveStatus> {
    const available = this.drive.isConfigured();
    const live = await this.connections.findLive(chapterId);
    return {
      available,
      service_account_email: this.drive.serviceAccountEmail(),
      connection: live ? toStatus(live, now) : null,
    };
  }

  /**
   * Connects the folder a link (or id) names. Checked with Google first, so
   * a folder not shared with Frapp is refused here with the address to share
   * it with, not discovered later by the worker. `whoCanSee` is the list the
   * folder's copies start behind (#5220), checked as any folder's is.
   */
  async connect(
    chapterId: string,
    userId: string,
    folderLink: string,
    whoCanSee: string[] | null = null,
  ): Promise<GoogleDriveStatus> {
    const email = this.requireAvailable();
    const folderId = parseDriveFolderId(folderLink);
    if (!folderId) {
      throw new BadRequestException(
        'That isn’t a Google Drive folder link. Open the folder in Drive and copy the link from the address bar.',
      );
    }
    await this.refuseIfConnected(chapterId);
    const list =
      (await this.documents.checkedList(chapterId, userId, whoCanSee)) ?? null;
    let folder;
    try {
      folder = await this.drive.getItem(folderId);
    } catch (error) {
      if (
        error instanceof GoogleDriveApiError &&
        (error.kind === 'not_found' || error.kind === 'forbidden')
      ) {
        throw new BadRequestException(
          `Frapp can’t see that folder yet. In Google Drive, share it with ${email} as a Viewer, then connect again.`,
        );
      }
      // A key Google refuses, the Drive API switched off (mapped to `failed`
      // by the client), or an outage: the officer can only retry, so the
      // reason goes to the logs.
      throw new ServiceUnavailableException(
        'Couldn’t reach Google Drive. Try again in a moment.',
        { cause: toReportableError(error) },
      );
    }
    if (folder.mimeType !== GOOGLE_DRIVE_FOLDER_MIME) {
      throw new BadRequestException(
        'That link is to a file, not a folder. Connect the folder that holds it.',
      );
    }
    try {
      await this.connections.create({
        chapter_id: chapterId,
        folder_id: folder.id,
        folder_name: folder.name || 'Google Drive folder',
        connected_by: userId,
        who_can_see: list,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        await this.refuseIfConnected(chapterId);
        throw new ConflictException(
          'That folder is already connected to another chapter in Frapp.',
        );
      }
      throw error;
    }
    return this.status(chapterId);
  }

  /** One folder per chapter, and none while the last one is still leaving. */
  private async refuseIfConnected(chapterId: string): Promise<void> {
    const existing = await this.connections.findAny(chapterId);
    if (!existing) return;
    throw new ConflictException(
      existing.status === 'disconnecting'
        ? 'The last folder is still leaving Documents. Try again in a minute.'
        : 'A Drive folder is already connected. Disconnect it first.',
    );
  }

  /** Brings the next sync forward to the worker's next pass. */
  async syncNow(chapterId: string): Promise<GoogleDriveStatus> {
    this.requireAvailable();
    if (!(await this.connections.markDue(chapterId, new Date()))) {
      throw new NotFoundException('No Drive folder is connected.');
    }
    return this.status(chapterId);
  }

  /**
   * Disconnects the folder. The worker then removes its copies from
   * Documents; the files in Drive are untouched. Works while Drive is off
   * here too, so an officer can always stop it (the copies then go once it
   * is back).
   */
  async disconnect(chapterId: string): Promise<void> {
    if (!(await this.connections.disconnect(chapterId, new Date()))) {
      throw new NotFoundException('No Drive folder is connected.');
    }
  }

  private requireAvailable(): string {
    const email = this.drive.serviceAccountEmail();
    if (!this.drive.isConfigured() || !email) {
      throw new ServiceUnavailableException(
        'Google Drive isn’t available on this server yet.',
      );
    }
    return email;
  }
}

function toStatus(
  live: ChapterDriveConnection,
  now: Date,
): NonNullable<GoogleDriveStatus['connection']> {
  return {
    folder_id: live.folder_id,
    folder_name: live.folder_name,
    folder_url: `https://drive.google.com/drive/folders/${live.folder_id}`,
    status: live.status === 'no_access' ? 'no_access' : 'active',
    last_synced_at: live.last_synced_at,
    synced_count: live.synced_count,
    skipped_count: live.skipped_count,
    folders_left_out: live.folders_left_out,
    who_can_see: live.who_can_see,
    // Due already (just connected, Sync now, or more to copy) or mid-pass.
    syncing:
      live.status === 'active' &&
      (Date.parse(live.sync_due_at) <= now.getTime() ||
        (live.sync_lease_until !== null &&
          Date.parse(live.sync_lease_until) > now.getTime())),
  };
}

/**
 * The folder id in a Drive folder link, or a bare id. Accepts
 * `drive.google.com/drive/folders/<id>` (with `/u/<n>/` and a query) and
 * `drive.google.com/open?id=<id>`. Null for anything else.
 */
export function parseDriveFolderId(input: string): string | null {
  const value = input.trim();
  if (/^[A-Za-z0-9_-]{10,}$/.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.hostname !== 'drive.google.com') return null;
  const path = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(url.pathname);
  if (path) return path[1];
  const id = url.searchParams.get('id');
  if (id && /^[A-Za-z0-9_-]{10,}$/.test(id)) return id;
  return null;
}
