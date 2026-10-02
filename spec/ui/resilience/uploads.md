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
[Confirm upload with API (send metadata)]  ← web retries a transient failure 2x
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
| Signed URL request fails | A definitive refusal (a 4xx other than the intermediary statuses 408, 499 and 460: no posting rights, a file the API rejects, the throttler's 429) is not retried, because a retry gets the same answer ([API retry § Writes](api-retry.md#writes), #2199, #3100). Any other failure: web retries 2x, mobile doesn't retry. In chat, the toast shows the server's reason for a refusal, or asks the member to retry in a moment for a 429; that copy lives with each client's chat upload flow (`uploadFailureDescription` in `apps/web/components/chat/composer.tsx`, `UPLOAD_FAILED` in `apps/mobile/lib/chat/attachment-upload.ts`). Web's other uploads (documents, backwork, service proof, avatar) toast the body's message as-is, which for a 429 is still the throttler's framework text (#3142). |
| Upload to Storage fails (network) | Show "Upload interrupted. [Retry]". Do NOT re-request signed URL (reuse). |
| Upload to Storage fails (timeout) | Show "Upload timed out. Check your connection and try again." |
| Confirm metadata fails | File is in storage but not tracked. Web retries a transient failure 2x; a refusal isn't retried. On persistent failure: "File uploaded but not saved. [Retry]" |

## Chunked Upload (Future Enhancement)

For files > 5MB, consider chunked upload for resumability. Not in v1 scope, but the signed URL flow supports it.

---
