# Search Service Specification

## Overview
The `SearchService` (`apps/api/src/application/services/search.service.ts`) provides global search functionality across multiple domains including Backwork, Events, Members, and Chat Messages within a specific chapter.

## Error Handling
The service is responsible for gracefully handling database query errors.
When a generic `QueryError` is returned by the Supabase client, the service throws a NestJS `InternalServerErrorException` instead of a generic `Error`. This ensures that the global exception filter can accurately map the error to an HTTP 500 response.

## Security
The `SearchService` employs the `escapeFilterValue` utility to sanitize all user-provided search queries before interpolating them into PostgREST `.or()` filters. This prevents filter injection vulnerabilities, especially when queries contain reserved characters like commas, backslashes, or quotes.
