# Specification: Backwork (Academic Library)

## 1. Overview
The Backwork module provides a multi-tenant academic repository where chapter members can upload, search, and download study materials (exams, notes, study guides). It uses AWS S3 for storage via presigned URLs and Postgres (Drizzle ORM) for metadata.

## 2. Database Schema (Drizzle)

### `backwork_courses`
| Column | Type | Constraints |
| :--- | :--- | :--- |
| `id` | uuid | Primary Key, Default: gen_random_uuid() |
| `chapter_id` | uuid | References `chapters.id`, Not Null |
| `code` | text | Not Null (e.g., "CS101") |
| `name` | text | Not Null (e.g., "Intro to Computer Science") |
| `created_at` | timestamp | Default: now() |

### `backwork_professors`
| Column | Type | Constraints |
| :--- | :--- | :--- |
| `id` | uuid | Primary Key, Default: gen_random_uuid() |
| `chapter_id` | uuid | References `chapters.id`, Not Null |
| `name` | text | Not Null |
| `created_at` | timestamp | Default: now() |

### `backwork_resources`
| Column | Type | Constraints |
| :--- | :--- | :--- |
| `id` | uuid | Primary Key, Default: gen_random_uuid() |
| `chapter_id` | uuid | References `chapters.id`, Not Null |
| `course_id` | uuid | References `backwork_courses.id`, Not Null |
| `professor_id` | uuid | References `backwork_professors.id`, Not Null |
| `uploader_id` | uuid | References `users.id`, Not Null |
| `title` | text | Not Null |
| `term` | text | Not Null (e.g., "Fall 2024") |
| `s3_key` | text | Not Null, Unique |
| `file_hash` | text | Not Null |
| `tags` | text[] | Default: '[]' |
| `created_at` | timestamp | Default: now() |

**Unique Constraint:** `chapter_id` + `course_id` + `term` + `file_hash` (Duplicate prevention).

## 3. API Contracts

### `GET /api/backwork/upload-url`
- **Auth:** Required, Chapter Member.
- **Query Params:** `filename`, `contentType`.
- **Response:**
  ```json
  {
    "uploadUrl": "https://s3.amazonaws.com/...",
    "s3Key": "chapters/{chapter_id}/backwork/{uuid}"
  }
  ```

### `POST /api/backwork`
- **Auth:** Required, Chapter Member.
- **Body:**
  ```json
  {
    "courseCode": "CS101",
    "courseName": "Intro to CS",
    "professorName": "Smith",
    "term": "Fall 2024",
    "title": "Final Exam Prep",
    "s3Key": "...",
    "fileHash": "...",
    "tags": ["Exam", "Study Guide"]
  }
  ```
- **Logic:**
  1. Validate metadata.
  2. Check for duplicates (chapter + course + term + file_hash).
  3. Auto-vivify `backwork_courses` and `backwork_professors` if they don't exist for the chapter.
  4. Save `backwork_resources`.

### `GET /api/backwork/:id/download`
- **Auth:** Required, Chapter Member.
- **Response:**
  ```json
  {
    "downloadUrl": "https://s3.amazonaws.com/..."
  }
  ```

## 4. Domain Logic
- **Auto-vivification:** When a user provides a `courseCode` or `professorName` that doesn't exist in the chapter's dictionary, the system automatically creates the record.
- **Multi-Tenancy:** Every query must be scoped by `chapter_id` from the user's session/header.
- **Elastic Tags:** Tags are stored as a Postgres array for flexible searching without a rigid version/type system.
