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

## PostgREST `.or()` quoting in supabase-chat-message.repository.ts
`SupabaseChatMessageRepository.findPollsByChapter` builds an `.or()` filter for active polls using a server-generated ISO timestamp. That segment is passed through `escapeFilterValue` so the `.or()` template follows PostgREST string quoting. The inactive-poll branch uses `.filter(..., 'lte', ...)` with the bare ISO string because the Supabase JS client encodes filter operands; passing the same double-quoted PostgREST literal there would compare against a string that includes quote characters and break `lte` semantics.

## Bounded row cap on `findPollsByChapter`
That method always applies `.limit()` using `LIST_QUERY_LIMIT_*` from `apps/api/src/domain/constants/list-query-limits.ts` when `options.limit` is missing, invalid, or out of range, so a future caller cannot accidentally fetch an unbounded POLL row set for a chapter. `PollService.listPolls` clamps `limit` the same way as `PointsService.listTransactions` (default 50, inclusive 1–200) before calling the repository; the repository helper still normalizes for defense in depth.

## npm audit triage (issue #245)

### Overview

`npm audit` reported **58 vulnerabilities (1 critical, 19 high, 38 moderate)** at the repo root. The critical was `handlebars` (multiple advisories) pulled in transitively by `ts-jest` in `apps/api`. High-severity items split between direct deps (NestJS injection, multer in `@nestjs/platform-express`, lodash in `@nestjs/config`, etc.) and transitive deps (`minimatch`, `picomatch`, `node-forge`, `tar`, `undici`, `path-to-regexp`, `fast-uri`, `flatted`, `@xmldom/xmldom`) reachable through NestJS, Expo CLI tooling, Jest, and ESLint trees.

### Changes

- **Root `overrides`** (in `package.json`) force patched versions of transitive packages without requiring upstream releases. The override pattern is the canonical lever for transitive CVEs in this monorepo — extend it rather than patching individual workspaces. Overrides for `undici` and `@xmldom/xmldom` use unbounded floors (`>=6.24.0`, `>=0.8.13`) so consumers that declared a higher major (`jsdom@29`, `expo-server-sdk@5`, `plist@3`) retain it.
- **`@nestjs/*` patch bumps** in `apps/api/package.json` (`@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/swagger`, `@nestjs/config`, `@nestjs/cli`, `@nestjs/schematics`, `@nestjs/testing`) close the direct-dep high CVEs (NestJS injection, lodash, path-to-regexp, multer). The `vite` and `lodash` advisories cleared via the NestJS / vite transitive bumps that rode along, not via overrides.
- **`@infisical/cli`** bumped at the root (high `tar` advisory).

### Result

`npm audit`: **0 critical, 0 high, 26 moderate**. All 642 `apps/api` unit tests pass; full monorepo `check-types`, `lint`, and `apps/api` production build are clean.

### Remaining moderate advisories (deferred, tracked as issues)

- **Expo SDK 54 → 56 upgrade** (closes ~16 of the 26 remaining moderates): #289
- **`@swc/cli` 0.7 → 0.8 in `apps/api`**: #290
- **Outstanding `next` moderate advisories (web + landing)**: #291
- **`geist` (apps/web)**: #292
- **`brace-expansion` 5.x in minimatch 10.x tree**: not separately tracked — moderate only, and the override that would close it (`^2.0.3`) breaks minimatch 10.x at runtime (different exported API). Re-evaluate when an audit-clean cross-major version exists.

### Prevention

When `npm audit` flags transitive CVEs, prefer **`overrides` at the repo root** over per-workspace upgrades. Pin to the patched range cited in the advisory (e.g., `<=1.3.3` ⇒ override to `^1.4.0`) and re-run `rm package-lock.json && npm install` so the lockfile rebuilds against the new graph — a plain `npm install` will keep the old resolution.

## Security Fix: Unrestricted File Upload in Chapter Logos

### Overview
A high-severity security vulnerability related to unrestricted file uploads was identified and fixed in `apps/api/src/application/services/chapter.service.ts`.

### Details
Previously, the `requestLogoUploadUrl` method in `ChapterService` generated signed upload URLs without validating the provided `contentType` or file extension. This allowed an attacker to upload arbitrary files (e.g., `.html`, `.php`, `.exe`) to the branding storage bucket, posing a significant risk of Cross-Site Scripting (XSS) or other attacks if these assets were later served.

To fix this, strict whitelists were implemented using JavaScript `Set`s for `ALLOWED_LOGO_CONTENT_TYPES` (e.g., `image/jpeg`, `image/png`) and `ALLOWED_LOGO_EXTENSIONS`. Both the `contentType` header and the extracted file extension are now validated against these whitelists. If either validation fails, a `BadRequestException` is thrown, preventing the generation of the signed URL for malicious files.

### Prevention
Always enforce strict content-type and extension allowlists when generating signed storage URLs for user-uploaded content.
