import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  GOOGLE_DRIVE_API,
  GOOGLE_DRIVE_FOLDER_MIME,
  GoogleDriveApiError,
  type GoogleDriveItem,
  type IGoogleDriveApi,
} from '#domain/adapters/google-drive.interface';
import {
  CHAPTER_DRIVE_REPOSITORY,
  type IChapterDriveRepository,
} from '#domain/repositories/chapter-drive.repository.interface';
import type { ChapterDriveConnection } from '#domain/entities/chapter-drive-connection.entity';
import { isUniqueViolation } from '#domain/constants/postgres-error-codes';
import { normalizeManualCode } from '#domain/utils/check-in-token';
import { ChapterDocumentService } from '../chapter-document.service';
import { toReportableError } from '../../../infrastructure/observability/reportable-error';
import {
  googleDrivePicker,
  type GoogleDrivePicker,
} from '../../../config/google-drive-config';

/**
 * Folders read up the tree from the one being connected: Drive's own nesting
 * limit, so the walk ends where Frapp can no longer see a parent, not sooner.
 */
const MAX_ANCESTORS = 100;

/** The one scope a picked folder's sign-in asks for (#5583). */
const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/**
 * Google's reasons for refusing to share outside a Google Workspace (a
 * school's or a company's): the folder's owner can't fix that, the admin can.
 */
const SHARE_OUT_BLOCKED = new Set([
  'publishOutNotPermitted',
  'shareOutNotPermitted',
  'shareOutNotPermittedToUser',
  'cannotShareTeamDriveWithNonGoogleAccounts',
  'shareOutWarning',
]);

const RESHARE_MESSAGE =
  'Couldn’t open that folder with your Google account. Pick it again.';

export interface GoogleDriveStatus {
  available: boolean;
  service_account_email: string | null;
  /**
   * Google's folder picker for this server (#5583), or null when it isn't
   * set up and the folder is connected by its link.
   */
  picker: { client_id: string; api_key: string; app_id: string } | null;
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
  private readonly logger = new Logger(GoogleDriveService.name);

  constructor(
    @Inject(GOOGLE_DRIVE_API) private readonly drive: IGoogleDriveApi,
    @Inject(CHAPTER_DRIVE_REPOSITORY)
    private readonly connections: IChapterDriveRepository,
    private readonly documents: ChapterDocumentService,
  ) {}

  /** Read per call, as the rest of the Google config is, so tests can set it. */
  private picker(): GoogleDrivePicker | null {
    return googleDrivePicker();
  }

  async status(
    chapterId: string,
    now = new Date(),
  ): Promise<GoogleDriveStatus> {
    const available = this.drive.isConfigured();
    const live = await this.connections.findLive(chapterId);
    const picker = available ? this.picker() : null;
    return {
      available,
      service_account_email: this.drive.serviceAccountEmail(),
      picker: picker
        ? {
            client_id: picker.clientId,
            api_key: picker.apiKey,
            app_id: picker.appId,
          }
        : null,
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
    const folder = await this.fromDrive(() => this.drive.getItem(folderId), {
      unseen: `Frapp can’t see that folder yet. In Google Drive, share it with ${email} as a Viewer, then connect again.`,
    });
    if (folder.mimeType !== GOOGLE_DRIVE_FOLDER_MIME) {
      throw new BadRequestException(
        'That link is to a file, not a folder. Connect the folder that holds it.',
      );
    }
    // Taken first, so an editor of another chapter's folder is refused
    // before being asked to rename it (which that chapter would then see).
    await this.refuseIfTaken(chapterId, folder);
    await this.requireProof(chapterId, folder);
    await this.save(chapterId, userId, folder, list);
    return this.status(chapterId);
  }

  /**
   * Connects the folder the officer picked in Google's own picker (#5583),
   * with the access token their Google sign-in gave the picker. The token
   * is used here, once, and never kept: Frapp reads Drive as its service
   * account, so the folder is shared with it as a Viewer, as the officer.
   *
   * Picking is the proof the link flow's code was (#5185): Google shows the
   * picker only the officer's own Drive, and Frapp refuses a folder they
   * can't edit, as the code did. A folder already connected and now
   * unshared (`no_access`) is shared again the same way, and syncs at once.
   */
  async connectPicked(
    chapterId: string,
    userId: string,
    folderId: string,
    accessToken: string,
    whoCanSee: string[] | null = null,
  ): Promise<GoogleDriveStatus> {
    const email = this.requireAvailable();
    const picker = this.picker();
    if (!picker) {
      throw new ServiceUnavailableException(
        'Picking a Google Drive folder isn’t available on this server yet.',
      );
    }
    await this.requireOwnSignIn(accessToken, picker);
    const existing = await this.connections.findAny(chapterId);
    const reshare =
      existing?.status === 'no_access' && existing.folder_id === folderId;
    if (!reshare) refuseIfConnected(existing);
    const list = reshare
      ? null
      : ((await this.documents.checkedList(chapterId, userId, whoCanSee)) ??
        null);
    const folder = await this.fromDrive(
      () => this.drive.getItemAs(accessToken, folderId),
      { unseen: RESHARE_MESSAGE, asMember: true },
    );
    if (folder.mimeType !== GOOGLE_DRIVE_FOLDER_MIME) {
      throw new BadRequestException(
        'That’s a file, not a folder. Pick the folder that holds it.',
      );
    }
    if (folder.trashed) {
      throw new BadRequestException(
        'That folder is in the trash in Google Drive. Restore it, then pick it again.',
      );
    }
    if (folder.canEdit !== true) {
      throw new ForbiddenException(
        `Only someone who can edit the folder in Google Drive can connect it. Ask its owner to connect it, or to share it with ${email} as a Viewer.`,
      );
    }
    if (!reshare) await this.refuseIfTaken(chapterId, folder);
    const permissionId = await this.shareIfUnseen(
      accessToken,
      folder.id,
      email,
    );
    if (reshare) {
      // Active again and due now, so the panel shows it syncing at once; a
      // pass that still can't see it turns it back.
      await this.connections.restoreAccess(chapterId, new Date());
      return this.status(chapterId);
    }
    try {
      await this.save(chapterId, userId, folder, list);
    } catch (error) {
      // Refused after sharing: take the share back, so a folder Frapp won't
      // sync isn't left shared with it. Not on a unique violation: then
      // another request connected this folder at the same moment, and Drive
      // gives one permission id per person, so it would be that request's
      // share taken back.
      if (permissionId && !isUniqueViolationOrConflict(error)) {
        await this.drive
          .unshare(accessToken, folder.id, permissionId)
          .catch((unshareError: unknown) => {
            this.logger.warn(
              `Couldn't take back a Drive share after a refused connect: ${
                unshareError instanceof Error ? unshareError.message : 'unknown'
              }`,
            );
          });
      }
      throw error;
    }
    return this.status(chapterId);
  }

  /**
   * The token is from this server's own Google sign-in, with `drive.file`:
   * not a token some other app was given for the same person.
   */
  private async requireOwnSignIn(
    accessToken: string,
    picker: GoogleDrivePicker,
  ): Promise<void> {
    let info: Awaited<ReturnType<IGoogleDriveApi['userTokenInfo']>>;
    try {
      info = await this.drive.userTokenInfo(accessToken);
    } catch (error) {
      throw new ServiceUnavailableException(
        'Couldn’t reach Google. Try again in a moment.',
        { cause: toReportableError(error) },
      );
    }
    if (
      !info ||
      info.clientId !== picker.clientId ||
      !info.scopes.includes(DRIVE_FILE_SCOPE)
    ) {
      throw new BadRequestException(
        'Your Google sign-in didn’t go through. Pick the folder again.',
      );
    }
  }

  /**
   * Shares the folder with the service account, unless it already sees it
   * (shared by hand before, or sitting in a folder that was): then nothing
   * is added, and nothing is taken back if connecting fails. Returns the
   * permission made, or null.
   */
  private async shareIfUnseen(
    accessToken: string,
    folderId: string,
    email: string,
  ): Promise<string | null> {
    const seen = await this.fromDrive(() => this.drive.getItem(folderId), {
      unseen: null,
    });
    if (seen) return null;
    try {
      return await this.drive.shareWithServiceAccount(accessToken, folderId);
    } catch (error) {
      if (
        error instanceof GoogleDriveApiError &&
        error.kind === 'forbidden' &&
        SHARE_OUT_BLOCKED.has(error.reason)
      ) {
        throw new ForbiddenException(
          'Your Google account’s organization (a school or a company) doesn’t let its folders be shared outside it. Use a folder in a personal Google account, or ask its admin to allow sharing.',
        );
      }
      if (error instanceof GoogleDriveApiError && error.status === 401) {
        throw new BadRequestException(RESHARE_MESSAGE);
      }
      // A 400 here is Google refusing this share (a sharing setting on the
      // folder or its drive), not an outage: retrying won't change it.
      if (
        error instanceof GoogleDriveApiError &&
        (error.kind === 'forbidden' ||
          error.kind === 'not_found' ||
          error.status === 400)
      ) {
        throw new ForbiddenException(
          `Google didn’t let you share that folder. Ask its owner to connect it, or to share it with ${email} as a Viewer.`,
          { cause: toReportableError(error) },
        );
      }
      throw new ServiceUnavailableException(
        'Couldn’t reach Google Drive. Try again in a moment.',
        { cause: toReportableError(error) },
      );
    }
  }

  /** Records the connection; a race to the same folder answers 409. */
  private async save(
    chapterId: string,
    userId: string,
    folder: GoogleDriveItem,
    list: string[] | null,
  ): Promise<void> {
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
  }

  /**
   * The service account sees every folder any chapter shares with it, so
   * seeing a folder doesn't make it this chapter's (#5185). The officer
   * proves it is by putting a code only this server makes, for this chapter
   * and this folder, in the folder: its name, its Description, or the name
   * of a file or folder directly inside it. Only someone who can edit the
   * folder can do that. Checked once, at connect; the code can go after.
   */
  private async requireProof(
    chapterId: string,
    folder: GoogleDriveItem,
  ): Promise<void> {
    const code = this.drive.proofCode(`${chapterId}:${folder.id}`);
    if (!code) {
      throw new ServiceUnavailableException(
        'Google Drive isn’t available on this server yet.',
      );
    }
    const holds = (text: string | null | undefined) => holdsCode(code, text);
    if (holds(folder.name) || holds(folder.description)) return;
    const children = await this.fromDrive(
      () => this.drive.listChildren(folder.id),
      { unseen: null },
    );
    if (children?.some((child) => holds(child.name))) return;
    throw new BadRequestException(
      `To show this folder is your chapter’s, add ${code} to its name in Google Drive, then connect again. Once it’s connected you can rename it back.`,
    );
  }

  /**
   * A folder feeds one chapter. Besides the folder itself (the unique index),
   * refused when it sits inside another chapter's connected folder: as one of
   * that folder's synced subfolders, or with a connected folder among the
   * folders above it, as far as Frapp can see up the tree.
   */
  private async refuseIfTaken(
    chapterId: string,
    folder: GoogleDriveItem,
  ): Promise<void> {
    const ids = [folder.id];
    let parent = folder.parents?.[0];
    for (let level = 0; parent && level < MAX_ANCESTORS; level += 1) {
      ids.push(parent);
      const above = await this.fromDrive(() => this.drive.getItem(parent!), {
        unseen: null,
      });
      parent = above?.parents?.[0];
    }
    if (await this.connections.folderTakenElsewhere(chapterId, ids)) {
      throw new ConflictException(
        'That folder, or a folder it sits in, is already connected to another chapter in Frapp.',
      );
    }
  }

  /**
   * One Drive call for connecting. A folder Frapp can't see answers `unseen`
   * as a 400, or null when `unseen` is null (a parent the service account
   * wasn't shared, which ends a walk up the tree).
   */
  private async fromDrive<T>(
    call: () => Promise<T>,
    options: { unseen: string; asMember?: boolean },
  ): Promise<T>;
  private async fromDrive<T>(
    call: () => Promise<T>,
    options: { unseen: null },
  ): Promise<T | null>;
  private async fromDrive<T>(
    call: () => Promise<T>,
    options: { unseen: string | null; asMember?: boolean },
  ): Promise<T | null> {
    try {
      return await call();
    } catch (error) {
      if (
        error instanceof GoogleDriveApiError &&
        (error.kind === 'not_found' ||
          error.kind === 'forbidden' ||
          // Made with the officer's own sign-in (`asMember`): a 401 is that
          // sign-in expiring or revoked, which picking again fixes. As the
          // service account it is a setup fault, for the logs.
          (options.asMember === true && error.status === 401))
      ) {
        if (options.unseen === null) return null;
        throw new BadRequestException(options.unseen);
      }
      // A key Google refuses, the Drive API switched off (mapped to `failed`
      // by the client), or an outage: the officer can only retry, so the
      // reason goes to the logs.
      throw new ServiceUnavailableException(
        'Couldn’t reach Google Drive. Try again in a moment.',
        { cause: toReportableError(error) },
      );
    }
  }

  /** One folder per chapter, and none while the last one is still leaving. */
  private async refuseIfConnected(chapterId: string): Promise<void> {
    refuseIfConnected(await this.connections.findAny(chapterId));
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

/** Refuses while `existing` (the chapter's connection, if any) stands. */
function refuseIfConnected(existing: ChapterDriveConnection | null): void {
  if (!existing) return;
  throw new ConflictException(
    existing.status === 'disconnecting'
      ? 'The last folder is still leaving Documents. Try again in a minute.'
      : 'A Drive folder is already connected. Disconnect it first.',
  );
}

/**
 * Whether connecting lost a race for the folder: the unique index itself,
 * or the 409 `save` answers it with.
 */
function isUniqueViolationOrConflict(error: unknown): boolean {
  return isUniqueViolation(error) || error instanceof ConflictException;
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
 * Whether `text` holds a connect code (#5185). Case, spaces, dashes and the
 * Crockford look-alikes (I or L for 1, O for 0) don't matter, as with a
 * check-in code typed by hand. Shared by folder connect and file links.
 */
export function holdsCode(
  code: string,
  text: string | null | undefined,
): boolean {
  return (
    !!text && normalizeManualCode(text).includes(normalizeManualCode(code))
  );
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
