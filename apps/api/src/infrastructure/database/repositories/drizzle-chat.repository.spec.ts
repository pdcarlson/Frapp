import { Test, TestingModule } from '@nestjs/testing';
import { DrizzleChatRepository } from './drizzle-chat.repository';
import { DRIZZLE_DB } from '../drizzle.provider';

describe('DrizzleChatRepository', () => {
  let repository: DrizzleChatRepository;

  const mockDb = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DrizzleChatRepository,
        {
          provide: DRIZZLE_DB,
          useValue: mockDb,
        },
      ],
    }).compile();

    repository = module.get<DrizzleChatRepository>(DrizzleChatRepository);
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  describe('createChannel', () => {
    it('should create and return a channel', async () => {
      const mockChannel = {
        id: '1',
        chapterId: 'c1',
        name: 'General',
        description: null,
        type: 'PUBLIC',
        allowedRoleIds: null,
        createdAt: new Date(),
      };
      mockDb.returning.mockResolvedValue([mockChannel]);

      const result = await repository.createChannel({
        chapterId: 'c1',
        name: 'General',
        description: null,
        type: 'PUBLIC',
        allowedRoleIds: null,
      });

      expect(result.name).toBe('General');
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe('createMessage', () => {
    it('should create and return a message', async () => {
      const mockMessage = {
        id: 'm1',
        channelId: 'ch1',
        senderId: 'u1',
        content: 'Hello',
        metadata: null,
        createdAt: new Date(),
      };
      mockDb.returning.mockResolvedValue([mockMessage]);

      const result = await repository.createMessage({
        channelId: 'ch1',
        senderId: 'u1',
        content: 'Hello',
        metadata: null,
      });

      expect(result.content).toBe('Hello');
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });
});
