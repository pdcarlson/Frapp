import type { FrappSupabaseClient } from '../../src/infrastructure/supabase/database.types';

/**
 * Tenant-scope harness for the Supabase repository layer.
 *
 * ## What this exists to catch
 *
 * #1083 wired the generated `Database` type into every repository, so the
 * compiler now rejects a wrong *type*. It cannot reject a wrong *column*: a
 * repository that filters `.eq('id', chapterId)` instead of
 * `.eq('chapter_id', chapterId)`, or that loses a tenant filter in a refactor,
 * type-checks perfectly and leaks another chapter's rows at runtime. That is the
 * failure mode this layer has no other net for — `cross-tenant-isolation.e2e-spec.ts`
 * covers seven repositories indirectly through HTTP, and nothing covers the rest.
 *
 * ## Why the fixture is built out of *colliding twins*
 *
 * The naive version of this test seeds one row per chapter and asserts the query
 * returns one row. It passes whether or not the tenant filter exists, because the
 * rows differ on some other column the query already filtered by — the test is
 * green for the wrong reason, which is worse than no test.
 *
 * So the seed is deliberately adversarial: for each table, chapter A's row and
 * chapter B's row are identical in **every** column except `id` and `chapter_id`.
 * Same `user_id`, same `name`, same `status`. Every predicate a
 * repository applies other than the tenant one therefore matches *both* rows, and
 * the only thing that can narrow the result to one chapter is a real tenant
 * filter. Drop it and the query returns the twin.
 *
 * `createTenantHarness` enforces that property rather than trusting the caller —
 * see `assertTwinsCollide`. A column that legitimately differs per chapter (a
 * foreign key to a chapter-scoped parent, say) has to be named in
 * `collisionExempt`, which makes weakening the fixture a visible decision instead
 * of an accident.
 *
 * ## What `expectTenantScoped` proves
 *
 * Three things, in this order, because the first failure is the informative one:
 *
 * 1. **The filter is present.** Every table operation carries a predicate binding
 *    that table's tenant column to the caller's chapter (or, for an RPC, a chapter
 *    argument). Checked first so a dropped filter reports as "no tenant predicate"
 *    rather than as whatever downstream confusion it causes — `.single()` matching
 *    both twins surfaces as PostgREST's `PGRST116`, which reads like an unrelated bug.
 * 2. **The filter is enforced on writes.** No row outside the caller's chapter was
 *    inserted, updated or deleted, compared against a snapshot taken before the call.
 * 3. **The filter is enforced on reads.** Nothing returned carries a foreign
 *    `chapter_id`, walked recursively so embedded rows count too.
 *
 * ## Scope, and what it cannot see
 *
 * The fake implements the PostgREST subset the repositories actually use. Anything
 * else throws instead of passing rows through, because a silently-ignored operator
 * widens the result set, and a widened result set in a tenancy test is a *pass*
 * that means nothing.
 *
 * It is deliberately not a Postgres emulator, and two limits follow that a spec
 * must not claim around:
 *
 * - **The `select()` projection is ignored.** Column lists and embed hints are
 *   recorded, never parsed, so dropping `!inner` from
 *   `'*, chat_channels!inner(chapter_id)'` — which turns a filtering join into a
 *   non-filtering one against real PostgREST — is invisible here.
 * - **Joins are not resolved.** An embed is whatever the seed row carries.
 *
 * Both belong to the live-PostgREST integration suite (`test/integration/`),
 * which exists for exactly this class of defect.
 */

/** Rows keyed by table name. */
export type Row = Record<string, unknown>;
export type SeededTables = Record<string, Row[]>;

export const CHAPTER_A = '11111111-1111-4111-8111-111111111111';
export const CHAPTER_B = '22222222-2222-4222-8222-222222222222';

/**
 * One user who belongs to both chapters. Cross-tenant bugs hide behind the
 * assumption that a user only ever appears in one chapter's rows; seeding the
 * same `user_id` on both twins removes that assumption.
 */
export const USER_SHARED = '33333333-3333-4333-8333-333333333333';
export const USER_A = '44444444-4444-4444-8444-444444444444';
export const USER_B = '55555555-5555-4555-8555-555555555555';

/** Marks a seed row as belonging to chapter A / chapter B. */
export function inA(columns: Row): Row {
  return { ...columns, chapter_id: CHAPTER_A };
}

export function inB(columns: Row): Row {
  return { ...columns, chapter_id: CHAPTER_B };
}

interface Filter {
  op: string;
  column: string;
  value: unknown;
}

export interface RecordedOp {
  table: string;
  mode: 'select' | 'insert' | 'update' | 'upsert' | 'delete';
  /** Top-level conjunctive predicates only — everything ANDed onto the query. */
  filters: Filter[];
  /**
   * Each `.or()` as its own group of disjuncts, kept out of `filters`.
   * Flattening them together would let one arm of
   * `.or('chapter_id.eq.X,name.eq.Y')` read as a binding tenant predicate while
   * the query returns every chapter whose row matches the other arm.
   */
  orGroups: Filter[][];
  /** Rows the filter chain resolved to (reads, updates, deletes). */
  matched: Row[];
  /** Payload rows for inserts/upserts. */
  payload: Row[];
}

export interface RecordedRpc {
  fn: string;
  args: Record<string, unknown>;
}

export interface TenantHarnessOptions {
  tables: SeededTables;
  /**
   * Column carrying the tenant on each table. Defaults to `chapter_id`.
   *
   * Two shapes need an override: `chapters` is the tenant root and scopes by its
   * own primary key (`id`), and a table reached through an embed scopes by the
   * dotted path the repository filters on (`chat_channels.chapter_id`).
   */
  tenantColumns?: Record<string, string>;
  /**
   * Tables with no `chapter_id` column of their own, so the harness can neither
   * require a tenant predicate nor check twin collision on them. Two different
   * situations end up here and the spec should say which it means:
   *
   * - genuinely global (`users`, `stripe_webhook_events`);
   * - indirectly scoped, where the chapter lives on a parent row
   *   (`event_attendance` via `events`, `poll_votes` and `chat_messages` via
   *   `chat_channels`).
   *
   * Listed explicitly, because inferring it from a seed that happens to omit
   * `chapter_id` would silently disarm every check in this file.
   */
  untenantedTables?: string[];
  /**
   * How to resolve the chapter of an untenanted table through its parent, e.g.
   * `{ event_attendance: { column: 'event_id', table: 'events' } }`.
   *
   * Without this, listing a table in `untenantedTables` turns off the
   * foreign-write check as well as the predicate check — and the indirectly
   * scoped tables are precisely the ones whose whole risk is that the chapter
   * lives somewhere else. With it, an update matched on a colliding column
   * (`user_id`, say) that reaches the other chapter's child row is still caught.
   */
  parentTenant?: Record<string, { column: string; table: string }>;
  /**
   * Columns allowed to differ between a table's chapter-A and chapter-B twins.
   * `id` and the tenant column are always exempt.
   */
  collisionExempt?: Record<string, string[]>;
  /** Canned RPC responses keyed by function name. */
  rpc?: Record<string, { data?: unknown; error?: unknown }>;
  /**
   * Argument name expected to carry the chapter on an RPC. Every repository
   * spells it `p_chapter_id`.
   *
   * Checking the *name* rather than "some argument equals the chapter" matters:
   * transposing two arguments — `{ p_user_id: chapterId, p_chapter_id: userId }` —
   * is an ordinary refactor slip, and a value-only check certifies it.
   */
  rpcChapterArg?: string;
}

export interface TenantHarness {
  /** Fake typed as the real client, for constructor injection. */
  client: FrappSupabaseClient;
  ops: RecordedOp[];
  rpcCalls: RecordedRpc[];
  /** Current stored rows for a table (a copy — mutating it does nothing). */
  rows(table: string): Row[];
  /** Restores the original seed and clears the operation log. */
  reset(): void;
  /**
   * Runs `fn` and asserts it stayed inside `chapterId`: a tenant predicate was
   * present, no foreign row was written, and nothing foreign was returned.
   * Returns whatever `fn` returned.
   */
  expectTenantScoped<T>(chapterId: string, fn: () => Promise<T>): Promise<T>;
}

const clone = <T>(value: T): T => structuredClone(value);

/** Chapter ids are strings; anything else means the lookup went wrong. */
const describeChapter = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value);

/**
 * Resolves `metadata->>expires_at` and `chat_channels.chapter_id` against a row,
 * so a seeded embed or JSON blob is readable by the same filter code as a plain
 * column.
 */
function readColumn(row: Row, column: string): unknown {
  const path = column.includes('->>')
    ? column.split('->>').flatMap((part) => part.split('->'))
    : column.split('.');

  let current: unknown = row;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Row)[key];
  }
  return current;
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

function matchesLike(value: unknown, pattern: string, ci: boolean): boolean {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  const raw = String(value);
  const source =
    '^' +
    pattern
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/%/g, '.*')
      .replace(/_/g, '.') +
    '$';
  return new RegExp(source, ci ? 'i' : '').test(raw);
}

function containsValue(actual: unknown, expected: unknown): boolean {
  // `.not('metadata', 'cs', '{"flagged":true}')` passes the operand as a raw
  // PostgREST JSON string rather than an object.
  if (typeof expected === 'string' && /^[[{]/.test(expected.trim())) {
    return containsValue(actual, JSON.parse(expected) as unknown);
  }
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) && expected.every((item) => actual.includes(item))
    );
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object') return false;
    return Object.entries(expected as Row).every(
      ([key, val]) => (actual as Row)[key] === val,
    );
  }
  return actual === expected;
}

function applyFilter(row: Row, filter: Filter): boolean {
  // `.not(column, op, value)` is stored with the inner predicate as its value so
  // negation resolves here rather than needing a parallel evaluator.
  //
  // Postgres negates three-valued logic: `NOT (NULL @> …)` is NULL, and a NULL
  // predicate does not match. A plain `!` would turn "false because the column
  // is NULL" into a match and hand back rows the real query drops — widening,
  // which is the one direction this file must not fail in.
  if (filter.op === '__not__') {
    const inner = filter.value as Filter;
    if (readColumn(row, inner.column) === undefined) return false;
    if (readColumn(row, inner.column) === null && inner.op !== 'is') {
      return false;
    }
    return !applyFilter(row, inner);
  }

  const actual = readColumn(row, filter.column);
  const expected = filter.value;

  switch (filter.op) {
    case 'eq':
      return actual === expected;
    case 'neq':
      // `col <> x` is NULL, not true, when col is NULL.
      return actual !== null && actual !== undefined && actual !== expected;
    case 'is':
      return actual === expected || (expected === null && actual === undefined);
    case 'in':
      return (expected as unknown[]).includes(actual);
    case 'gt':
      return actual != null && compare(actual, expected) > 0;
    case 'gte':
      return actual != null && compare(actual, expected) >= 0;
    case 'lt':
      return actual != null && compare(actual, expected) < 0;
    case 'lte':
      return actual != null && compare(actual, expected) <= 0;
    case 'like':
      return matchesLike(actual, String(expected), false);
    case 'ilike':
      return matchesLike(actual, String(expected), true);
    case 'cs':
    case 'contains':
      return containsValue(actual, expected);
    case 'overlaps':
      return (
        Array.isArray(actual) &&
        (expected as unknown[]).some((item) => actual.includes(item))
      );
    default:
      throw new Error(
        `tenant-scope harness: unsupported PostgREST operator "${filter.op}" on ` +
          `"${filter.column}". Implement it in applyFilter() — leaving it unhandled ` +
          `would widen the result set, and a widened result set makes a tenancy ` +
          `assertion pass without proving anything.`,
      );
  }
}

/** PostgREST spells literals inside a filter string; `.eq()` passes them typed. */
function coerceFilterLiteral(raw: string): unknown {
  const unquoted =
    raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
  if (raw.startsWith('"')) return unquoted;
  if (unquoted === 'null') return null;
  if (unquoted === 'true') return true;
  if (unquoted === 'false') return false;
  if (unquoted !== '' && !Number.isNaN(Number(unquoted))) {
    return Number(unquoted);
  }
  return unquoted;
}

/** Parses one `column.op.value` term of a PostgREST `.or()` string. */
function parseOrTerm(term: string): Filter {
  // A JSON path (`metadata->>expires_at`) contains no dot, but the arrow does,
  // so the column/operator split starts after it.
  const jsonSplit = term.lastIndexOf('->>');
  const searchFrom = jsonSplit === -1 ? 0 : jsonSplit + 3;
  const first = term.indexOf('.', searchFrom);
  const second = term.indexOf('.', first + 1);
  if (first === -1 || second === -1) {
    throw new Error(
      `tenant-scope harness: cannot parse .or() term "${term}". Expected ` +
        `"column.operator.value".`,
    );
  }

  const column = term.slice(0, first);
  let op = term.slice(first + 1, second);
  let rest = term.slice(second + 1);

  // PostgREST negates inside the term: `col.not.is.null`.
  if (op === 'not') {
    const inner = rest.indexOf('.');
    if (inner === -1) {
      throw new Error(
        `tenant-scope harness: cannot parse negated .or() term "${term}". ` +
          `Expected "column.not.operator.value".`,
      );
    }
    op = rest.slice(0, inner);
    rest = rest.slice(inner + 1);
    return {
      op: '__not__',
      column,
      value: { op, column, value: coerceFilterLiteral(rest) },
    };
  }

  return { op, column, value: coerceFilterLiteral(rest) };
}

/** Splits on top-level commas only — a quoted operand may contain them. */
function splitOrTerms(expression: string): string[] {
  const terms: string[] = [];
  let current = '';
  let quoted = false;
  for (const char of expression) {
    if (char === '"') quoted = !quoted;
    if (char === ',' && !quoted) {
      terms.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  terms.push(current);
  return terms;
}

function parseOr(expression: string): Filter[] {
  if (expression.includes('(')) {
    throw new Error(
      `tenant-scope harness: nested .or()/.and() groups are not supported ` +
        `("${expression}").`,
    );
  }
  return splitOrTerms(expression).map((term) => parseOrTerm(term.trim()));
}

/**
 * Fails the seed if chapter A's and chapter B's rows for a table differ on any
 * column that is not `id`, the tenant column, or explicitly exempted.
 *
 * Without this, a spec can weaken its own fixture by accident — give the two
 * chapters different `name`s and the repository's `.eq('name', …)` alone narrows
 * to one row, so the test passes with the tenant filter deleted.
 */
function assertTwinsCollide(
  table: string,
  rows: Row[],
  tenantColumn: string,
  exempt: string[],
): void {
  const a = rows.filter((r) => r[tenantColumn] === CHAPTER_A);
  const b = rows.filter((r) => r[tenantColumn] === CHAPTER_B);
  if (a.length === 0 || b.length === 0) {
    throw new Error(
      `tenant-scope harness: table "${table}" must be seeded in both chapters ` +
        `(got ${a.length} in A, ${b.length} in B). A single-chapter seed cannot ` +
        `demonstrate that a tenant filter is doing anything.`,
    );
  }
  if (a.length !== b.length) {
    // Returning quietly here would disable the guard the whole design rests on
    // for that table, and the spec author would get no signal. An unbalanced
    // seed is the natural shape once a spec needs two rows in one chapter for
    // ordering or paging — and it is exactly then that a non-tenant predicate
    // can narrow on its own.
    throw new Error(
      `tenant-scope harness: table "${table}" is seeded unevenly (${a.length} ` +
        `in A, ${b.length} in B), so the twins cannot be paired and the ` +
        `collision guard would silently check nothing. Seed the same number of ` +
        `rows in both chapters.`,
    );
  }

  const ignored = new Set(['id', tenantColumn, ...exempt]);
  for (let i = 0; i < a.length; i++) {
    const columns = new Set([...Object.keys(a[i]), ...Object.keys(b[i])]);
    for (const column of columns) {
      if (ignored.has(column)) continue;
      const left = JSON.stringify(a[i][column]);
      const right = JSON.stringify(b[i][column]);
      if (left !== right) {
        throw new Error(
          `tenant-scope harness: "${table}" twins differ on "${column}" ` +
            `(${left} vs ${right}). Every column except id/${tenantColumn} must ` +
            `collide, or a non-tenant predicate can narrow the result on its own ` +
            `and the test passes with the tenant filter removed. Seed the same ` +
            `value in both chapters, or add "${column}" to collisionExempt for ` +
            `"${table}" if it genuinely has to differ.`,
        );
      }
    }
  }
}

export function createTenantHarness(
  options: TenantHarnessOptions,
): TenantHarness {
  const seed = clone(options.tables);
  const untenanted = new Set(options.untenantedTables ?? []);
  const tenantColumnFor = (table: string) =>
    options.tenantColumns?.[table] ?? 'chapter_id';

  // An unseeded parent makes every child's chapter unresolvable, which silently
  // turns the foreign-write check back off — the same failure shape the
  // twin-collision guard exists to prevent, so it fails loudly too.
  for (const [table, parent] of Object.entries(options.parentTenant ?? {})) {
    if (options.tables[table] && !options.tables[parent.table]) {
      throw new Error(
        `tenant-scope harness: "${table}" resolves its chapter through ` +
          `"${parent.table}", which is not seeded. Every row would have an ` +
          `unknowable chapter and the foreign-write check would pass on ` +
          `anything. Seed "${parent.table}".`,
      );
    }
  }

  for (const [table, rows] of Object.entries(options.tables)) {
    if (untenanted.has(table)) continue;
    // An embed path (`chat_channels.chapter_id`) still collides on the row's own
    // `chapter_id` when the spec seeds one; fall back to it for the twin check.
    const column = tenantColumnFor(table).includes('.')
      ? 'chapter_id'
      : tenantColumnFor(table);
    assertTwinsCollide(
      table,
      rows,
      column,
      options.collisionExempt?.[table] ?? [],
    );
  }

  let tables: SeededTables = clone(seed);
  const ops: RecordedOp[] = [];
  const rpcCalls: RecordedRpc[] = [];

  const build = (table: string) => {
    const filters: Filter[] = [];
    const orGroups: Filter[][] = [];
    let mode: RecordedOp['mode'] = 'select';
    let payload: Row[] = [];
    let conflictColumns: string[] = ['id'];
    let head = false;
    let limit: number | null = null;
    let range: [number, number] | null = null;
    let executed = false;
    let totalBeforePaging: number | null = null;
    const orderBy: { column: string; ascending: boolean }[] = [];

    const matching = (): Row[] => {
      const stored = tables[table] ?? [];
      let rows = stored.filter(
        (row) =>
          filters.every((f) => applyFilter(row, f)) &&
          orGroups.every((group) => group.some((f) => applyFilter(row, f))),
      );

      // `.order()` has to be real: `.order('created_at', { ascending: false })
      // .limit(1)` is how "the latest row" is spelled, and a no-op `order` makes
      // that return whichever row the seed happened to list first.
      for (const { column, ascending } of [...orderBy].reverse()) {
        rows = [...rows].sort((left, right) => {
          const a = readColumn(left, column);
          const b = readColumn(right, column);
          if (a === b) return 0;
          if (a === null || a === undefined) return 1;
          if (b === null || b === undefined) return -1;
          return ascending ? compare(a, b) : -compare(a, b);
        });
      }

      // PostgREST's `count` is the total matching the filters, before paging.
      totalBeforePaging = rows.length;
      if (range) rows = rows.slice(range[0], range[1] + 1);
      if (limit !== null) rows = rows.slice(0, limit);
      return rows;
    };

    /** Applies the pending write and records the operation exactly once. */
    const execute = (): { rows: Row[]; count: number } => {
      if (executed) {
        throw new Error(
          `tenant-scope harness: builder for "${table}" was awaited twice.`,
        );
      }
      executed = true;

      let matched: Row[];
      if (mode === 'insert' || mode === 'upsert') {
        const stored = (tables[table] ??= []);
        // The conflict target decides which existing row an upsert overwrites,
        // which makes it a tenancy control in its own right: drop `chapter_id`
        // from `onConflict` and one chapter's write lands on another's row.
        const conflictMatch = (candidate: Row, row: Row) =>
          conflictColumns.every(
            (column) =>
              readColumn(candidate, column) === readColumn(row, column),
          );
        matched = [];
        for (const row of payload) {
          const existing =
            mode === 'upsert'
              ? stored.find((candidate) => conflictMatch(candidate, row))
              : undefined;
          if (existing) {
            Object.assign(existing, row);
            matched.push(existing);
          } else {
            const inserted = clone(row);
            stored.push(inserted);
            matched.push(inserted);
          }
        }
      } else if (mode === 'update') {
        matched = matching();
        for (const row of matched) Object.assign(row, payload[0] ?? {});
      } else if (mode === 'delete') {
        matched = matching();
        tables[table] = (tables[table] ?? []).filter(
          (row) => !matched.includes(row),
        );
      } else {
        matched = matching();
      }

      ops.push({
        table,
        mode,
        filters: [...filters],
        orGroups: orGroups.map((group) => [...group]),
        matched: clone(matched),
        payload: clone(payload),
      });

      return {
        rows: clone(matched),
        count: totalBeforePaging ?? matched.length,
      };
    };

    const addFilter = (op: string, column: string, value: unknown) => {
      filters.push({ op, column, value });
      return builder;
    };

    const builder: Record<string, unknown> = {
      select: jest.fn(
        (_columns?: string, opts?: { count?: string; head?: boolean }) => {
          if (opts?.head) head = true;
          return builder;
        },
      ),
      insert: jest.fn((value: Row | Row[]) => {
        mode = 'insert';
        payload = Array.isArray(value) ? value : [value];
        return builder;
      }),
      upsert: jest.fn((value: Row | Row[], opts?: { onConflict?: string }) => {
        mode = 'upsert';
        payload = Array.isArray(value) ? value : [value];
        conflictColumns = opts?.onConflict
          ? opts.onConflict.split(',').map((column) => column.trim())
          : ['id'];
        return builder;
      }),
      update: jest.fn((value: Row) => {
        mode = 'update';
        payload = [value];
        return builder;
      }),
      delete: jest.fn(() => {
        mode = 'delete';
        return builder;
      }),

      eq: jest.fn((c: string, v: unknown) => addFilter('eq', c, v)),
      neq: jest.fn((c: string, v: unknown) => addFilter('neq', c, v)),
      is: jest.fn((c: string, v: unknown) => addFilter('is', c, v)),
      in: jest.fn((c: string, v: unknown[]) => addFilter('in', c, v)),
      gt: jest.fn((c: string, v: unknown) => addFilter('gt', c, v)),
      gte: jest.fn((c: string, v: unknown) => addFilter('gte', c, v)),
      lt: jest.fn((c: string, v: unknown) => addFilter('lt', c, v)),
      lte: jest.fn((c: string, v: unknown) => addFilter('lte', c, v)),
      like: jest.fn((c: string, v: unknown) => addFilter('like', c, v)),
      ilike: jest.fn((c: string, v: unknown) => addFilter('ilike', c, v)),
      contains: jest.fn((c: string, v: unknown) => addFilter('contains', c, v)),
      overlaps: jest.fn((c: string, v: unknown) => addFilter('overlaps', c, v)),
      filter: jest.fn((c: string, op: string, v: unknown) =>
        addFilter(op, c, v),
      ),
      not: jest.fn((c: string, op: string, v: unknown) =>
        addFilter('__not__', c, { op, column: c, value: v } satisfies Filter),
      ),
      or: jest.fn((expression: string) => {
        orGroups.push(parseOr(expression));
        return builder;
      }),
      match: jest.fn((query: Row) => {
        for (const [column, value] of Object.entries(query)) {
          addFilter('eq', column, value);
        }
        return builder;
      }),

      order: jest.fn((column: string, opts?: { ascending?: boolean }) => {
        orderBy.push({ column, ascending: opts?.ascending !== false });
        return builder;
      }),
      limit: jest.fn((n: number) => {
        limit = n;
        return builder;
      }),
      range: jest.fn((from: number, to: number) => {
        range = [from, to];
        return builder;
      }),

      single: jest.fn(() => {
        const { rows } = execute();
        if (rows.length === 1) {
          return Promise.resolve({ data: rows[0], error: null, count: 1 });
        }
        return Promise.resolve({
          data: null,
          count: rows.length,
          error: {
            code: 'PGRST116',
            message: `JSON object requested, multiple (or no) rows returned (got ${rows.length})`,
          },
        });
      }),
      maybeSingle: jest.fn(() => {
        const { rows } = execute();
        // PostgREST returns PGRST116 for *more than one* row too — it is
        // "zero or one", not "the first one". Returning `rows[0]` would make a
        // dropped tenant filter look like a successful lookup.
        if (rows.length > 1) {
          return Promise.resolve({
            data: null,
            count: rows.length,
            error: {
              code: 'PGRST116',
              message: `JSON object requested, multiple (or no) rows returned (got ${rows.length})`,
            },
          });
        }
        return Promise.resolve({
          data: rows[0] ?? null,
          error: null,
          count: rows.length,
        });
      }),
      then: (
        resolve: (v: {
          data: Row[] | null;
          error: null;
          count: number;
        }) => unknown,
        reject?: (e: unknown) => unknown,
      ) => {
        let settled: { data: Row[] | null; error: null; count: number };
        try {
          const { rows, count } = execute();
          settled = { data: head ? null : rows, error: null, count };
        } catch (err) {
          return Promise.reject(err).then(resolve, reject);
        }
        return Promise.resolve(settled).then(resolve, reject);
      },
    };

    return builder;
  };

  const client = {
    from: jest.fn((table: string) => build(table)),
    rpc: jest.fn((fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args: clone(args ?? {}) });
      const canned = options.rpc?.[fn];
      return Promise.resolve({
        data: canned?.data ?? null,
        error: canned?.error ?? null,
      });
    }),
  };

  const snapshot = () => clone(tables);

  /**
   * The chapter a row belongs to, or `undefined` when it cannot be determined —
   * a genuinely global table, or an untenanted one with no `parentTenant`.
   */
  const tenantValueOf = (
    row: Row,
    table: string,
    world: SeededTables,
  ): unknown => {
    const parent = options.parentTenant?.[table];
    if (parent) {
      const parentId = readColumn(row, parent.column);
      const parentRow = (world[parent.table] ?? []).find(
        (candidate) => candidate.id === parentId,
      );
      return parentRow
        ? tenantValueOf(parentRow, parent.table, world)
        : undefined;
    }
    if (untenanted.has(table)) return undefined;
    const column = tenantColumnFor(table);
    return readColumn(row, column.includes('.') ? 'chapter_id' : column);
  };

  /** Every object anywhere in `value` that carries a `chapter_id`. */
  const collectTenantBearing = (value: unknown, found: Row[] = []): Row[] => {
    if (Array.isArray(value)) {
      for (const item of value) collectTenantBearing(item, found);
      return found;
    }
    if (value && typeof value === 'object') {
      const row = value as Row;
      if ('chapter_id' in row) found.push(row);
      for (const nested of Object.values(row)) {
        if (nested && typeof nested === 'object')
          collectTenantBearing(nested, found);
      }
    }
    return found;
  };

  const assertTenantPredicate = (
    chapterId: string,
    since: number,
    rpcSince: number,
  ): void => {
    const relevant = ops.slice(since);
    const rpcs = rpcCalls.slice(rpcSince);

    if (relevant.length === 0 && rpcs.length === 0) {
      throw new Error(
        `tenant-scope: the call issued no query and no RPC, so nothing was ` +
          `verified. expectTenantScoped resolving here would report "scoped" ` +
          `about a code path that never touched the database — assert on the ` +
          `return value directly instead.`,
      );
    }

    for (const op of relevant) {
      if (untenanted.has(op.table)) continue;
      const column = tenantColumnFor(op.table);

      if (op.mode === 'insert' || op.mode === 'upsert') {
        const bad = op.payload.filter(
          (row) => readColumn(row, column) !== chapterId,
        );
        if (bad.length > 0) {
          throw new Error(
            `tenant-scope: ${op.mode} into "${op.table}" carried ` +
              `${column}=${JSON.stringify(bad.map((r) => readColumn(r, column)))} ` +
              `but the caller's chapter is ${chapterId}.`,
          );
        }
        continue;
      }

      // Only top-level conjunctive predicates count. A tenant filter that is
      // one arm of an `.or()` binds nothing: the other arm still matches every
      // chapter.
      const bound = op.filters.some(
        (f) => f.op === 'eq' && f.column === column && f.value === chapterId,
      );
      if (!bound) {
        throw new Error(
          `tenant-scope: ${op.mode} on "${op.table}" ran without a tenant ` +
            `predicate. Expected .eq('${column}', '${chapterId}'); the query ` +
            `applied ${JSON.stringify(
              op.filters.map((f) => [f.op, f.column, f.value]),
            )}${
              op.orGroups.length > 0
                ? ` plus ${op.orGroups.length} .or() group(s), which do not ` +
                  `count — a disjunct leaves the other arm unscoped`
                : ''
            }. A query with no tenant filter returns every chapter's rows.`,
        );
      }
    }

    // Every RPC in the window must carry the chapter, regardless of whether the
    // call also touched a table. Gating this on "no table op ran" meant adding
    // one pre-flight SELECT to an RPC method retired its only tenancy control.
    const chapterArg = options.rpcChapterArg ?? 'p_chapter_id';
    for (const call of rpcs) {
      if (call.args[chapterArg] !== chapterId) {
        throw new Error(
          `tenant-scope: rpc ${call.fn} did not pass ${chapterArg}=${chapterId} ` +
            `(got ${JSON.stringify(call.args[chapterArg])}). Args: ` +
            `${JSON.stringify(call.args)}. The work happens inside SQL, so this ` +
            `argument is the only tenancy control on the path.`,
        );
      }
    }
  };

  const assertNoForeignWrites = (
    before: SeededTables,
    chapterId: string,
  ): void => {
    for (const table of new Set([
      ...Object.keys(before),
      ...Object.keys(tables),
    ])) {
      const priorRows = before[table] ?? [];
      const currentRows = tables[table] ?? [];
      const chapterOfPrior = (row: Row) => tenantValueOf(row, table, before);
      const chapterOfCurrent = (row: Row) => tenantValueOf(row, table, tables);

      for (const prior of priorRows) {
        const priorChapter = chapterOfPrior(prior);
        // `undefined` means the row's chapter is not determinable — a global
        // table, or an untenanted one with no `parentTenant` mapping. Nothing
        // can be concluded about it either way, so it is left alone.
        if (priorChapter === undefined) continue;

        if (priorChapter === chapterId) {
          // A write that rewrites `chapter_id` hands the row to another tenant.
          // The predicate check cannot see this — the query is correctly scoped;
          // it is the *payload* that escapes.
          const moved = currentRows.find((row) => row.id === prior.id);
          if (moved && chapterOfCurrent(moved) !== chapterId) {
            throw new Error(
              `tenant-scope: row ${String(prior.id)} in "${table}" was ` +
                `REASSIGNED from chapter ${chapterId} to ` +
                `${describeChapter(chapterOfCurrent(moved))}.`,
            );
          }
          continue;
        }
        const current = currentRows.find((row) => row.id === prior.id);
        if (!current) {
          throw new Error(
            `tenant-scope: row ${String(prior.id)} in "${table}" belongs to ` +
              `chapter ${describeChapter(priorChapter)} and was DELETED by a ` +
              `call scoped to ${chapterId}.`,
          );
        }
        if (JSON.stringify(current) !== JSON.stringify(prior)) {
          throw new Error(
            `tenant-scope: row ${String(prior.id)} in "${table}" belongs to ` +
              `chapter ${describeChapter(priorChapter)} and was MUTATED by a ` +
              `call scoped to ${chapterId}.\n  before: ${JSON.stringify(prior)}\n` +
              `  after:  ${JSON.stringify(current)}`,
          );
        }
      }

      const priorIds = new Set(priorRows.map((row) => row.id));
      for (const current of currentRows) {
        if (priorIds.has(current.id)) continue;
        const insertedChapter = chapterOfCurrent(current);
        if (insertedChapter !== undefined && insertedChapter !== chapterId) {
          throw new Error(
            `tenant-scope: a call scoped to ${chapterId} INSERTED row ` +
              `${String(current.id)} into "${table}" under chapter ` +
              `${describeChapter(insertedChapter)}.`,
          );
        }
      }
    }
  };

  const assertReturnedRowsScoped = (result: unknown, chapterId: string) => {
    const leaked = collectTenantBearing(result).filter(
      (row) => row.chapter_id !== chapterId,
    );
    if (leaked.length > 0) {
      throw new Error(
        `tenant-scope: returned ${leaked.length} row(s) from another chapter ` +
          `while scoped to ${chapterId}: ${JSON.stringify(leaked)}`,
      );
    }
  };

  return {
    client: client as unknown as FrappSupabaseClient,
    ops,
    rpcCalls,
    rows: (table: string) => clone(tables[table] ?? []),
    reset: () => {
      tables = clone(seed);
      ops.length = 0;
      rpcCalls.length = 0;
    },
    async expectTenantScoped<T>(
      chapterId: string,
      fn: () => Promise<T>,
    ): Promise<T> {
      const before = snapshot();
      const opsBefore = ops.length;
      const rpcBefore = rpcCalls.length;

      let result: T | undefined;
      let failure: { reason: unknown } | null = null;
      try {
        result = await fn();
      } catch (reason) {
        failure = { reason };
      }

      // The tenancy assertions run first, but the repository's own failure is
      // the evidence for whatever they report, so it rides along as `cause`
      // rather than being discarded. A dropped filter usually surfaces first as
      // `.single()` matching both twins, and `PGRST116` on its own reads like an
      // unrelated bug.
      try {
        assertTenantPredicate(chapterId, opsBefore, rpcBefore);
        assertNoForeignWrites(before, chapterId);
      } catch (assertion) {
        if (failure && assertion instanceof Error) {
          assertion.cause = failure.reason;
        }
        throw assertion;
      }

      if (failure) return Promise.reject(failure.reason);
      assertReturnedRowsScoped(result, chapterId);
      return result as T;
    },
  };
}
