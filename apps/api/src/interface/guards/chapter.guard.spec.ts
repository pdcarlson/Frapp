/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import {
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ChapterGuard } from './chapter.guard';
import { DRIZZLE_DB } from '../../infrastructure/database/drizzle.provider';
import { users, members } from '../../infrastructure/database/schema';

describe('ChapterGuard', () => {
  let guard: ChapterGuard;
  let dbMock: any;

  const mockExecutionContext = {
    switchToHttp: jest.fn().mockReturnThis(),
    getRequest: jest.fn(),
  } as unknown as ExecutionContext;

  beforeEach(async () => {
    // Basic mock for drizzle query builder
    const queryBuilder = {
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      execute: jest.fn(), // Drizzle executes queries with .execute() or awaiting
      then: jest.fn(), // For awaitable promises
    };

    // Make the query builder awaitable
    (queryBuilder as any).then = (resolve: any) => resolve([]);

    dbMock = {
      select: jest.fn(() => queryBuilder),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChapterGuard,
        {
          provide: DRIZZLE_DB,
          useValue: dbMock,
        },
      ],
    }).compile();

    guard = module.get<ChapterGuard>(ChapterGuard);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('canActivate', () => {
    it('should deny access if x-chapter-id header is missing', async () => {
      const mockRequest = {
        headers: {},
        user: { sub: 'user_123' },
      };
      (
        mockExecutionContext.switchToHttp().getRequest as jest.Mock
      ).mockReturnValue(mockRequest);

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should deny access if user is not authenticated (no user object)', async () => {
      const mockRequest = {
        headers: { 'x-chapter-id': 'chapter_1' },
      };
      (
        mockExecutionContext.switchToHttp().getRequest as jest.Mock
      ).mockReturnValue(mockRequest);

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should deny access if user does not belong to the chapter', async () => {
      const mockRequest = {
        headers: { 'x-chapter-id': 'chapter_1' },
        user: { sub: 'user_123' },
      };
      (
        mockExecutionContext.switchToHttp().getRequest as jest.Mock
      ).mockReturnValue(mockRequest);

      // Mock DB query to return empty array (user not found in chapter)
      const queryBuilder = dbMock.select();
      queryBuilder.execute.mockResolvedValue([]);
      // Make the builder awaitable for direct await usage
      queryBuilder.then = (resolve: any) => resolve([]);

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should allow access if user belongs to the chapter', async () => {
      const mockRequest = {
        headers: { 'x-chapter-id': 'chapter_1' },
        user: { sub: 'user_123' },
      };
      (
        mockExecutionContext.switchToHttp().getRequest as jest.Mock
      ).mockReturnValue(mockRequest);

      // Mock DB query to return user record
      const queryBuilder = dbMock.select();
      const mockResult = [{ id: 'user_uuid' }];
      queryBuilder.execute.mockResolvedValue(mockResult);
      queryBuilder.then = (resolve: any) => resolve(mockResult);

      const result = await guard.canActivate(mockExecutionContext);
      expect(result).toBe(true);

      // Verify DB was queried with correct parameters
      expect(dbMock.select).toHaveBeenCalled();
      // We expect a join between users and members
      expect(queryBuilder.from).toHaveBeenCalledWith(users);
      expect(queryBuilder.innerJoin).toHaveBeenCalledWith(
        members,
        expect.anything(),
      );
      expect(queryBuilder.where).toHaveBeenCalledWith(expect.anything());
    });
  });
});
