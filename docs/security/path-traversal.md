# Path Traversal Security Fix

## Vulnerability
File upload endpoints that construct a storage path based directly on a user-provided `filename` were vulnerable to path traversal.

If an attacker supplies a filename such as `../../../malicious.txt`, the generated storage path could escape the isolated namespace constraint (e.g., `chapters/${chapterId}/documents/`).

## Remediation
All endpoints using `getSignedUploadUrl` that accept user-provided filenames now pass the filename through `path.basename(filename)`. This strips any directory path information from the filename, ensuring the file remains in the assigned storage path namespace.

- `chapter-document.service.ts`
- `backwork.service.ts`
- `chat.service.ts`
- `user.service.ts`
- `chapter.service.ts`
