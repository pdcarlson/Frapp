# Image and file upload resilience

> Part of [Network resilience](README.md).

## Upload Flow

```
[User selects file]
       │
       ▼
[Request signed URL from API]  ← web retries a transient failure 2x
       │
       ▼
[Upload file to Supabase Storage via signed URL]
       │ ← show progress bar (XHR progress event)
       │ ← timeout: 60s for files up to 25MB
       │
       ▼
[Confirm upload with API (send metadata)]  ← retry 2x
       │
       ▼
[Success: show uploaded file/image]
```

## Progress Indicator

For file uploads, show a progress bar with percentage:

```typescript
const xhr = new XMLHttpRequest();
xhr.upload.onprogress = (e) => {
  if (e.lengthComputable) {
    setProgress(Math.round((e.loaded / e.total) * 100));
  }
};
```

## Upload Failure Recovery

| Failure Point | Recovery |
|---------------|----------|
| Signed URL request fails | A definitive refusal (a 4xx other than an intermediary's 408: no posting rights, a file the API rejects, the throttler's 429) is not retried, because a retry gets the same answer ([API retry § Writes](api-retry.md#writes), #2199, #3100). Its toast shows the server's reason, or asks the member to retry in a moment for a 429. Any other failure: web retries 2x, mobile doesn't retry. The copy lives with each client's upload flow (`uploadFailureDescription` in `apps/web/components/chat/composer.tsx`, `UPLOAD_FAILED` in `apps/mobile/lib/chat/attachment-upload.ts`). |
| Upload to Storage fails (network) | Show "Upload interrupted. [Retry]". Do NOT re-request signed URL (reuse). |
| Upload to Storage fails (timeout) | Show "Upload timed out. Check your connection and try again." |
| Confirm metadata fails | File is in storage but not tracked. Retry confirm 3x. On persistent failure: "File uploaded but not saved. [Retry]" |

## Chunked Upload (Future Enhancement)

For files > 5MB, consider chunked upload for resumability. Not in v1 scope, but the signed URL flow supports it.

---
