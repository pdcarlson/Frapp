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
 * a chapter can't lock itself out, and a file's uploader always sees it.
 * Holding `chapter_docs:manage` passes nothing (Paul's pick 2): a chair who
 * runs the library doesn't see the exec board's files.
 */
import { channelAccessEntry } from '@repo/validation';
import type { ChannelAccessHolder } from './channel-access';
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
  if (list == null) return true;
  if (holder.wildcard) return true;
  return list.some((entry) => holder.entries.has(entry));
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

/**
 * Whether the viewer sees a file: its uploader always does; anyone else
 * passes its folder's list and its own. A file filed under a name no folder
 * row claims has no folder list to pass.
 */
export function canSeeDocument(
  document: Pick<ChapterDocument, 'folder' | 'who_can_see' | 'uploaded_by'>,
  folderLists: ReadonlyMap<string, readonly string[] | null>,
  viewer: DocumentViewer,
): boolean {
  if (document.uploaded_by === viewer.userId) return true;
  const folderList =
    document.folder !== null ? (folderLists.get(document.folder) ?? null) : null;
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
