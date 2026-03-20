# Alumni Controller Tests

## Covered Scenarios

### 1. Guards and Decorators
- The controller must be decorated with `SupabaseAuthGuard`, `ChapterGuard`, and `PermissionsGuard`.
- The controller must require the `MEMBERS_VIEW` permission via `@RequirePermissions(SystemPermissions.MEMBERS_VIEW)`.

### 2. `list` Endpoint Filtering
The `list` method fetches alumni members filtered by query parameters and delegates to the `MemberService`. The following variations are tested:

- **No filters**: Calling the method without any query parameters successfully delegates to the service with only the `chapterId`.
- **Graduation Year Filter**: Passing `graduation_year` successfully parses the string to an integer and passes it to the filter object.
- **City and Company Filter**: Passing partial strings for `city` and `company` appropriately includes them in the filter object.
- **Combined Filters**: Providing all valid parameters populates the filter object completely.
- **Invalid Inputs**:
  - Empty strings passed for query parameters are ignored.
  - Invalid types or formats for `graduation_year` (e.g., non-numeric strings) are ignored and omitted from the filter object.

## Mocking Strategy
- `MemberService` is fully mocked with specific implementations for `findAlumniByChapter`.
- Built-in NestJS guards (`SupabaseAuthGuard`, `ChapterGuard`, `PermissionsGuard`) are overridden to always return `true` using `TestingModule.overrideGuard()`.
