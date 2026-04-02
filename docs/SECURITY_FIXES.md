## Security Fix: Supabase Filter Injection

### Overview
A high-severity security vulnerability related to Supabase `.or()` filter injection was identified and fixed in `apps/api/src/application/services/search.service.ts`.

### Details
Previously, user input was directly interpolated into Supabase `.or()` filter strings (e.g., `.or(\`title.ilike.${pattern}\`)`). Because PostgREST uses specific characters like commas `,` and parentheses `()` to parse query logic, an attacker could inject these characters to modify the query structure and bypass isolation scopes.

To fix this, an `escapeFilterValue` utility was created in `apps/api/src/infrastructure/supabase/supabase.utils.ts` that safely escapes string values according to PostgREST quoting rules (surrounding values with double quotes and doubling internal quotes). All dynamic inputs used in `.or()` filters within `search.service.ts` are now sanitized using this utility.

### Prevention
Always use `escapeFilterValue` when injecting dynamic user inputs into PostgREST/Supabase string filters.

## PostgREST filter injection in supabase-backwork-resource.repository.ts
Added `escapeFilterValue` to sanitize search input in `SupabaseBackworkResourceRepository` to prevent PostgREST grammar elements from being injected into `.or()` filters.

## Security Fix: Unrestricted File Upload in Chapter Logos

### Overview
A high-severity security vulnerability related to unrestricted file uploads was identified and fixed in `apps/api/src/application/services/chapter.service.ts`.

### Details
Previously, the `requestLogoUploadUrl` method in `ChapterService` generated signed upload URLs without validating the provided `contentType` or file extension. This allowed an attacker to upload arbitrary files (e.g., `.html`, `.php`, `.exe`) to the branding storage bucket, posing a significant risk of Cross-Site Scripting (XSS) or other attacks if these assets were later served.

To fix this, strict whitelists were implemented using JavaScript `Set`s for `ALLOWED_LOGO_CONTENT_TYPES` (e.g., `image/jpeg`, `image/png`) and `ALLOWED_LOGO_EXTENSIONS`. Both the `contentType` header and the extracted file extension are now validated against these whitelists. If either validation fails, a `BadRequestException` is thrown, preventing the generation of the signed URL for malicious files.

### Prevention
Always enforce strict content-type and extension allowlists when generating signed storage URLs for user-uploaded content.

## Security Headers
- Added `helmet` in `apps/api/src/main.ts` as global middleware for baseline defense-in-depth headers (e.g., X-Frame-Options, X-Content-Type-Options). Relaxed Content-Security-Policy (inline scripts and `unsafe-eval` for Swagger UI) applies only on Swagger paths: `/docs`, `/docs/*`, `/docs-json`, and `/docs-yaml`. All other routes use Helmet’s default (stricter) CSP.
