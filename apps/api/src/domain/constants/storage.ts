/**
 * Profile-photo storage layout, shared by the upload path
 * (UserService.requestAvatarUploadUrl) and the account-deletion purge
 * (AccountDeletionService). Keeping bucket + folder shape in one place is
 * load-bearing: the purge treats an empty folder as success, so a layout
 * change made in only one of the two services would silently orphan PII.
 */
export const PROFILES_BUCKET = 'profiles';

/** Folder holding a user's profile photos within one chapter (no trailing slash). */
export function profileFolderPrefix(chapterId: string, userId: string): string {
  return `chapters/${chapterId}/profiles/${userId}`;
}
