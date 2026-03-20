# Content Validation Security Specification

## Overview
When generating signed URLs for secure file uploads (such as uploading to Supabase Storage), we must validate the content before handing out a signed URL to prevent malicious uploads or storage abuse.

## Validations Required

### 1. Allowed Content Types
A strict `ALLOWED_CONTENT_TYPES` Set must be maintained in the service to validate the `input.contentType`. Example safe content types:
- Images: `image/jpeg`, `image/png`, `image/gif`, `image/webp`
- Documents: `application/pdf`, `text/plain`, `text/csv`, Office documents (`.docx`, `.xlsx`, `.pptx`)

### 2. Blocked File Extensions
A strict `BLOCKED_EXTENSIONS` Set must be maintained to explicitly block executables and scripts. If the user's `input.filename` contains these extensions, the upload must be rejected.
Example blocked extensions:
- `.exe`, `.sh`, `.bat`, `.cmd`

## Error Handling
If either validation fails, the service must throw a `BadRequestException` immediately, returning an HTTP 400 response and preventing the signed URL from being generated.

## Affected Services
- `ChapterDocumentService` (handles chapter documents)
- `ChatService` (handles chat attachments)
