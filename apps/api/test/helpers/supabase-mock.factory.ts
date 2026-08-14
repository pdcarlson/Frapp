export interface SupabaseAuthUser {
  id: string;
  email?: string | null;
}

export function createSupabaseQueryBuilder(response?: {
  data?: unknown;
  error?: unknown;
}) {
  return {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    lt: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    or: jest.fn().mockReturnThis(),
    contains: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest
      .fn()
      .mockResolvedValue({ data: response?.data ?? null, error: null }),
    single: jest
      .fn()
      .mockResolvedValue({ data: response?.data ?? null, error: null }),
  };
}

export function createSupabaseMock(options?: {
  authUser?: SupabaseAuthUser | null;
  tableData?: Record<string, unknown>;
}) {
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: options?.authUser ?? null },
        error: null,
      }),
    },
    from: jest.fn().mockImplementation(() =>
      createSupabaseQueryBuilder({
        data: options?.tableData ?? null,
      }),
    ),
  };
}

/** Rows keyed by table name, e.g. `{ members: [{ id, user_id, chapter_id }] }`. */
export type SeededTables = Record<string, Record<string, unknown>[]>;

type Row = Record<string, unknown>;

/**
 * A Supabase double that actually applies `.eq()` / `.in()` / `.is()` filters
 * against seeded rows, instead of returning one canned payload for every table.
 *
 * `createSupabaseMock` is enough for specs that stub the guards, but a
 * cross-tenant test has to drive the **real** `ChapterGuard`, which reads
 * `users` -> `members` -> `chapters` and branches on what comes back. With the
 * canned mock every table returns the same object and the guard cannot tell a
 * member from a non-member, so the test would pass no matter what the guard did.
 *
 * Supported: `select` / `insert` / `update` / `delete`, the filters the API's
 * repositories actually use, `order` / `limit`, `single` / `maybeSingle`, and
 * awaiting the builder directly (PostgREST builders are thenable). Unsupported
 * operators are no-ops that widen the result set rather than narrowing it —
 * safe for a test whose assertions are all "this must be rejected".
 */
export function createTableAwareSupabaseMock(options: {
  authUser?: SupabaseAuthUser | null;
  claims?: Record<string, unknown> | null;
  tables: SeededTables;
}) {
  const tables = options.tables;

  const build = (table: string) => {
    let rows: Row[] = [...(tables[table] ?? [])];
    let mode: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: Row | Row[] | null = null;

    const result = () => {
      if (mode === 'insert') {
        const inserted = Array.isArray(payload) ? payload : [payload ?? {}];
        (tables[table] ??= []).push(...inserted);
        return inserted;
      }
      if (mode === 'update') {
        rows.forEach((r) => Object.assign(r, payload ?? {}));
        return rows;
      }
      if (mode === 'delete') {
        tables[table] = (tables[table] ?? []).filter((r) => !rows.includes(r));
        return rows;
      }
      return rows;
    };

    const builder: Record<string, unknown> = {
      select: jest.fn(() => builder),
      insert: jest.fn((v: Row | Row[]) => {
        mode = 'insert';
        payload = v;
        return builder;
      }),
      update: jest.fn((v: Row) => {
        mode = 'update';
        payload = v;
        return builder;
      }),
      upsert: jest.fn((v: Row) => {
        mode = 'insert';
        payload = v;
        return builder;
      }),
      delete: jest.fn(() => {
        mode = 'delete';
        return builder;
      }),
      eq: jest.fn((col: string, val: unknown) => {
        rows = rows.filter((r) => r[col] === val);
        return builder;
      }),
      neq: jest.fn((col: string, val: unknown) => {
        rows = rows.filter((r) => r[col] !== val);
        return builder;
      }),
      in: jest.fn((col: string, vals: unknown[]) => {
        rows = rows.filter((r) => vals.includes(r[col]));
        return builder;
      }),
      is: jest.fn((col: string, val: unknown) => {
        rows = rows.filter((r) => r[col] === val);
        return builder;
      }),
      // Range/text operators the repositories use for reporting windows. Not
      // meaningful for tenancy, so they pass rows through untouched.
      lt: jest.fn(() => builder),
      lte: jest.fn(() => builder),
      gt: jest.fn(() => builder),
      gte: jest.fn(() => builder),
      or: jest.fn(() => builder),
      ilike: jest.fn(() => builder),
      contains: jest.fn(() => builder),
      overlaps: jest.fn(() => builder),
      order: jest.fn(() => builder),
      range: jest.fn(() => builder),
      limit: jest.fn((n: number) => {
        rows = rows.slice(0, n);
        return builder;
      }),
      single: jest.fn(() => {
        const found = result();
        return Promise.resolve(
          found.length === 1
            ? { data: found[0], error: null }
            : {
                data: null,
                error: { code: 'PGRST116', message: 'no rows returned' },
              },
        );
      }),
      maybeSingle: jest.fn(() => {
        const found = result();
        return Promise.resolve({ data: found[0] ?? null, error: null });
      }),
      then: (
        resolve: (v: { data: Row[]; error: null }) => unknown,
        reject?: (e: unknown) => unknown,
      ) =>
        Promise.resolve({ data: result(), error: null }).then(resolve, reject),
    };

    return builder;
  };

  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: options.authUser ?? null },
        error: null,
      }),
      getClaims: jest.fn().mockResolvedValue({
        data: options.claims ? { claims: options.claims } : null,
        error: null,
      }),
    },
    from: jest.fn().mockImplementation((table: string) => build(table)),
    rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
    // The chat push/bridge workers subscribe on bootstrap. They catch and log
    // their own failures, so the app boots either way — this just keeps the
    // suite's output free of two stack traces per `app.init()`.
    channel: jest.fn().mockImplementation(() => {
      const ch: Record<string, unknown> = {
        on: jest.fn(() => ch),
        subscribe: jest.fn(() => ch),
        unsubscribe: jest.fn().mockResolvedValue('ok'),
        send: jest.fn().mockResolvedValue('ok'),
        track: jest.fn().mockResolvedValue('ok'),
      };
      return ch;
    }),
    removeChannel: jest.fn().mockResolvedValue('ok'),
    storage: {
      from: jest.fn().mockReturnValue({
        createSignedUrl: jest.fn().mockResolvedValue({
          data: { signedUrl: 'https://signed' },
          error: null,
        }),
        createSignedUploadUrl: jest.fn().mockResolvedValue({
          data: { signedUrl: 'https://signed' },
          error: null,
        }),
        remove: jest.fn().mockResolvedValue({ data: null, error: null }),
      }),
    },
  };
}
