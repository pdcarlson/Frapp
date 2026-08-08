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

/**
 * Generated-report storage layout, shared by the export path
 * (ReportExportService) and the two purges that reap it — the scheduled
 * retention sweep and the account-deletion sweep (ReportRetentionService).
 *
 * Here for the same reason as the profiles pair above, and the stakes are
 * higher: roster exports embed member names, emails, roles, and join dates
 * (`report-columns.ts` ROSTER_COLUMNS), and both purges treat an empty folder
 * as success. A layout change made in the writer alone would leave the purges
 * sweeping a prefix nothing writes to, reporting success over surviving PII.
 */
export const REPORTS_BUCKET = 'reports';

/**
 * Folder whose sub-folders are the chapters that hold generated reports.
 *
 * The retention sweep enumerates its children rather than reading chapter ids
 * from the database. Storage folders are virtual — one exists exactly while an
 * object lives beneath it — so this yields the chapters that actually have
 * exports, and drops each back out once its prefix is swept empty. Two things
 * fall out of that: the sweep costs one listing per *exporting* chapter rather
 * than per chapter in the product, and a prefix whose `chapters` row was
 * deleted still gets reaped instead of being stranded with nothing left to
 * name it.
 */
export const REPORTS_ROOT_PREFIX = 'chapters';

/** Folder holding one chapter's generated reports (no trailing slash). */
export function reportsFolderPrefix(chapterId: string): string {
  return `${REPORTS_ROOT_PREFIX}/${chapterId}/reports`;
}
