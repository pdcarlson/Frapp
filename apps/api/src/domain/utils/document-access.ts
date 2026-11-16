/**
 * Who can see a Documents folder or file (#3642 piece 1, Paul 2026-11-16;
 * `spec/behavior/chapter-docs.md` § Who can see). Pure: callers resolve the
 * viewer (`ChapterDocumentService.viewerFor`) and the folders, and every read
 * path asks here, so the list, a single read, previews, Ask and attachments
 * can't decide differently.
 *
 * A list is a chat channel's (`channel-access-lists.ts` in `@repo/validation`):
 * `null` is everyone who can open Documents, else `tier:`, `role:` and
 * `group:` entries. A file's `null` is "same as its folder", and a file's own
 * list narrows its folder's: a member passes both. `*` passes every list, so
 * a chapter can't lock itself out, and a file's uploader always sees it,
 * unless it's a Google Drive copy: those are filed as uploaded by whoever
 * connected the folder, who mustn't see past every list through that.
 * Holding `chapter_docs:manage` passes nothing (Paul's pick 2): a chair who
 * runs the library doesn't see the exec board's files.
 */
import { channelAccessEntry } from '@repo/validation';
import { listAdmits, type ChannelAccessHolder } from './channel-access';
import type {
  ChapterDocument,
  ChapterDocumentFolder,
} from '../entities/chapter-document.entity';
import { OUTSIDE_TIERS_RANK, type ActorReach } from './role-rank';

/** The member reading Documents, as the gate needs them. */
export interface DocumentViewer {
  userId: string;
  holder: ChannelAccessHolder;
}

/** Whether `list` admits `holder`: `null` admits everyone, `*` passes any list. */
export function documentListAdmits(
  list: readonly string[] | null | undefined,
  holder: ChannelAccessHolder,
): boolean {
  return listAdmits(list ?? null, holder);
}

/**
 * What resolving the viewer must read for these folders and files: nothing
 * when none has a list (every chapter until an officer sets one), and their
 * groups only when some list names a group.
 */
export function listsInPlay(
  lists: Iterable<readonly string[] | null | undefined>,
): { any: boolean; groups: boolean } {
  let any = false;
  for (const list of lists) {
    if (list == null) continue;
    any = true;
    if (list.some((entry) => entry.startsWith('group:'))) {
      return { any, groups: true };
    }
  }
  return { any, groups: false };
}

/** Each folder's list by its name, the key `ChapterDocument.folder` holds. */
export function folderListsByName(
  folders: readonly Pick<ChapterDocumentFolder, 'name' | 'who_can_see'>[],
): ReadonlyMap<string, readonly string[] | null> {
  return new Map(
    folders.map((folder) => [folder.name, folder.who_can_see ?? null]),
  );
}

/** Whether the viewer sees a folder. */
export function canSeeFolder(
  folder: Pick<ChapterDocumentFolder, 'who_can_see'>,
  viewer: DocumentViewer,
): boolean {
  return documentListAdmits(folder.who_can_see, viewer.holder);
}

/** Whether `userId` is the file's own uploader, who always sees it. */
export function isOwnUpload(
  document: Pick<ChapterDocument, 'uploaded_by' | 'drive_file_id'>,
  userId: string,
): boolean {
  return document.uploaded_by === userId && document.drive_file_id === null;
}

/**
 * Whether the viewer sees a file: its uploader always does (a Drive copy has
 * no uploader in that sense); anyone else passes its folder's list and its
 * own. A file filed under a name no folder row claims has no folder list to
 * pass; renaming and deleting a folder move its files in one transaction so
 * that never happens to a restricted one.
 */
export function canSeeDocument(
  document: Pick<
    ChapterDocument,
    'folder' | 'who_can_see' | 'uploaded_by' | 'drive_file_id'
  >,
  folderLists: ReadonlyMap<string, readonly string[] | null>,
  viewer: DocumentViewer,
): boolean {
  if (isOwnUpload(document, viewer.userId)) return true;
  const folderList =
    document.folder !== null
      ? (folderLists.get(document.folder) ?? null)
      : null;
  return (
    documentListAdmits(folderList, viewer.holder) &&
    documentListAdmits(document.who_can_see, viewer.holder)
  );
}

/**
 * The tiers a list set by `actor` always holds (Paul's pick 3, as invites
 * keep to rank, #4546): their own tier and every tier above it, so a chair
 * can hide a file from members but never from the exec board. `*` is exempt
 * and adds none. A caller outside the tiers gets `null`: they reach nothing,
 * so they may not set a list.
 */
export function tiersAListKeeps(
  actor: Pick<ActorReach, 'rank' | 'wildcard'>,
  tiers: readonly { id: string; position: number }[],
): string[] | null {
  if (actor.wildcard) return [];
  if (actor.rank === OUTSIDE_TIERS_RANK) return null;
  return tiers
    .filter((tier) => tier.position <= actor.rank)
    .map((tier) => channelAccessEntry('tier', tier.id));
}

/**
 * Whether moving a file from a folder with list `current` into one with list
 * `next` can't let anyone new see it (#5220, Drive sync never widens).
 * Judged by entries alone, so it errs toward "wider": `null` (everyone) is
 * no wider than anything only when `current` is also `null`, and a list is no
 * wider when every entry it holds is also in `current`. A `role:` entry
 * whose role sits in a tier `current` names still counts as wider, which
 * holds a move a person would call safe rather than ever letting one through
 * that isn't.
 */
export function listNoWiderThan(
  next: readonly string[] | null | undefined,
  current: readonly string[] | null | undefined,
): boolean {
  if (current == null) return true;
  if (next == null) return false;
  const held = new Set(current);
  return next.every((entry) => held.has(entry));
}
