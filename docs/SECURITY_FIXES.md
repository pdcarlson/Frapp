## Security Fix: Supabase Filter Injection

### Overview
A high-severity security vulnerability related to Supabase `.or()` filter injection was identified and fixed in `apps/api/src/application/services/search.service.ts`.

### Details
Previously, user input was directly interpolated into Supabase `.or()` filter strings (e.g., `.or(\`title.ilike.${pattern}\`)`). Because PostgREST uses specific characters like commas `,` and parentheses `()` to parse query logic, an attacker could inject these characters to modify the query structure and bypass isolation scopes.

To fix this, an `escapeFilterValue` utility was created in `apps/api/src/infrastructure/supabase/supabase.utils.ts` that safely escapes string values according to PostgREST quoting rules (surrounding values with double quotes and doubling internal quotes). All dynamic inputs used in `.or()` filters within `search.service.ts` are now sanitized using this utility.

### Prevention
Always use `escapeFilterValue` when injecting dynamic user inputs into PostgREST/Supabase string filters.
