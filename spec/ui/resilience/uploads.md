# Image and file upload resilience

> Part of [Network resilience](README.md).

## Upload Flow

```
[User selects file]
       │
       ▼
[Request signed URL from API]  ← retry 2x on failure
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
| Signed URL request fails | Retry 2x. On persistent failure: "Upload failed. Please try again." |
| Upload to Storage fails (network) | Show "Upload interrupted. [Retry]". Do NOT re-request signed URL (reuse). |
| Upload to Storage fails (timeout) | Show "Upload timed out. Check your connection and try again." |
| Confirm metadata fails | File is in storage but not tracked. Retry confirm 3x. On persistent failure: "File uploaded but not saved. [Retry]" |

## Chunked Upload (Future Enhancement)

For files > 5MB, consider chunked upload for resumability. Not in v1 scope, but the signed URL flow supports it.

---
