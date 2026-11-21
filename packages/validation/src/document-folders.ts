/**
 * What joins a Documents folder's path in its name (#5220, #5337): Google
 * Drive sync names a subfolder by its path ("Chapter files / Rush / 2024",
 * `folderPath` in the API's `google-drive-sync.service.ts`), and both apps
 * split on it to draw the folders as a tree (`@repo/hooks/document-folder-tree`).
 * One constant, so the two sides can't drift apart and silently flatten the tree.
 */
export const DOCUMENT_FOLDER_PATH_SEPARATOR = " / ";
