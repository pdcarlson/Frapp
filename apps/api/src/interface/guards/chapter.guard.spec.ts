import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ChapterGuard } from './chapter.guard';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';

describe('ChapterGuard', () => {
  let guard: ChapterGuard;
  let mockFrom: jest.Mock;

  const buildRequest = (overrides: Record<string, unknown> = {}) => ({
    headers: { 'x-chapter-id': 'chapter-1' },
    supabaseUser: { id: 'auth-123' },
    appUser: undefined as unknown,
    member: undefined as unknown,
    chapterId: undefined as unknown,
    ...overrides,
  });

  const mockExecutionContext = (request: ReturnType<typeof buildRequest>): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    }) as unknown as ExecutionContext;

  beforeEach(async () => {
    mockFrom = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChapterGuard,
        {
          provide: SUPABASE_CLIENT,
          useValue: { from: mockFrom },
        },
      ],
    }).compile();

    guard = module.get(ChapterGuard);
  });

  it('should throw ForbiddenException when x-chapter-id header is missing', async () => {
    const request = buildRequest({ headers: {} });
    const ctx = mockExecutionContext(request);
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('should throw ForbiddenException when supabaseUser is not set', async () => {
    const request = buildRequest({ supabaseUser: undefined });
    const ctx = mockExecutionContext(request);
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('should throw ForbiddenException when app user not found', async () => {
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: null }),
        }),
      }),
    });

    const request = buildRequest();
    const ctx = mockExecutionContext(request);
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('should throw ForbiddenException when user is not a chapter member', async () => {
    const selectMock = jest.fn();

    // First call: users table → returns user
    // Second call: members table → returns null
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: { id: 'user-1' } }),
            }),
          }),
        };
      }
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: null }),
            }),
          }),
        }),
      };
    });

    const request = buildRequest();
    const ctx = mockExecutionContext(request);
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('should set appUser, member, and chapterId on request when valid', async () => {
    const appUser = { id: 'user-1' };
    const member = { id: 'member-1', role_ids: ['role-1'] };

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: appUser }),
            }),
          }),
        };
      }
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: member }),
            }),
          }),
        }),
      };
    });

    const request = buildRequest();
    const ctx = mockExecutionContext(request);
    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(request.appUser).toEqual(appUser);
    expect(request.member).toEqual(member);
    expect(request.chapterId).toBe('chapter-1');
  });
});
