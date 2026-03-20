# BackworkService Test Specifications

## 1. Overview
This document outlines the testing strategy for `apps/api/src/application/services/backwork.service.ts`. The focus is on validating security controls, particularly file upload validations, as well as core CRUD operations and entity auto-vivification.

## 2. Test Cases

### 2.1 File Upload Security Validation
- **Upload Validation (Allowed vs Blocked):**
  - Ensure `requestUploadUrl` throws `BadRequestException` when `filename` contains an invalid or blocked extension (e.g., `.exe`, `.sh`). Only explicit allowlist extensions are permitted.
  - Ensure `requestUploadUrl` throws `BadRequestException` when `contentType` is not strictly in the `ALLOWED_CONTENT_TYPES` list.
- **Path Generation:** Ensure the storage path correctly uses `crypto.randomUUID()` to prevent collisions and sanitizes `filename` using `path.basename` to prevent path traversal.

### 2.2 Confirm Upload & Auto-Vivification
- **Duplicate Prevention:** Throws `ConflictException` if a file with the same `file_hash` already exists in the chapter.
- **Metadata Handling:** Successfully saves optional metadata like assignment type, semester, and tags.
- **Department Auto-Vivification:** Reuses existing departments by code; if not found, creates a new department record automatically.
- **Professor Auto-Vivification:** Reuses existing professors by name; if not found, creates a new professor record automatically.

### 2.3 Retrieval & Deletion
- **Retrieve by ID:** Generates a signed download URL upon successful fetch.
- **Retrieve Failure:** Throws `NotFoundException` when attempting to fetch or delete a non-existent resource.
- **Deletion:** Successfully deletes the underlying storage file via the storage provider before deleting the database record.

## 3. Dependencies
- `IBackworkResourceRepository`, `IBackworkDepartmentRepository`, `IBackworkProfessorRepository`
- `IStorageProvider`
