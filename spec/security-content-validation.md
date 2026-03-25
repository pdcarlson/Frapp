# Content Validation Security Specification

## Overview
When generating signed URLs for secure file uploads (such as uploading to Supabase Storage), we must validate the content before handing out a signed URL to prevent malicious uploads or storage abuse.

## Validations Required

### 1. Allowed Content Types
A strict `ALLOWED_CONTENT_TYPES` Set must be maintained in the service to validate the `input.contentType`. **IMPORTANT**: SVG files (`image/svg+xml`, `.svg`) must **never** be allowed in `ALLOWED_CONTENT_TYPES` or `ALLOWED_EXTENSIONS` without an explicit and robust server-side sanitization step. SVGs can contain embedded JavaScript `<script>` tags, leading to Stored XSS when rendered in the user's browser.

Example safe content types:
- Images: `image/jpeg`, `image/png`, `image/gif`, `image/webp`
- Documents: `application/pdf`, `text/plain`, `text/csv`, Office documents (`.docx`, `.xlsx`, `.pptx`)

### 2. Allowed File Extensions
A strict `ALLOWED_EXTENSIONS` Set must be maintained to explicitly allow only safe file extensions. If the user's `input.filename` extension is not in this list, the upload must be rejected. Blocklists must not be used.
Example allowed extensions:
- `.pdf`, `.docx`, `.jpg`, `.png`

## Error Handling
If either validation fails, the service must throw a `BadRequestException` immediately, returning an HTTP 400 response and preventing the signed URL from being generated.

## Affected Services
- `UserService` (handles avatar uploads)
- `ChapterDocumentService` (handles chapter documents)
- `ChatService` (handles chat attachments)
- `ChapterService` (handles chapter logos)
