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
