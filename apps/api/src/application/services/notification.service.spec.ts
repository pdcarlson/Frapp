import { Test, TestingModule } from '@nestjs/testing';
import { NotificationService } from './notification.service';
import { NOTIFICATION_REPOSITORY } from '../../domain/repositories/notification.repository.interface';
import { NOTIFICATION_PROVIDER } from '../../domain/adapters/notification.interface';

describe('NotificationService', () => {
  let service: NotificationService;
  let repo: {
    findTokensByUserId: jest.Mock;
    create: jest.Mock;
    getPreferences: jest.Mock;
  };
  let provider: {
    send: jest.Mock;
  };

  const mockRepo = {
    findTokensByUserId: jest.fn(),
    create: jest.fn(),
    getPreferences: jest.fn(),
  };

  const mockProvider = {
    send: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: NOTIFICATION_REPOSITORY, useValue: mockRepo },
        { provide: NOTIFICATION_PROVIDER, useValue: mockProvider },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
    repo = mockRepo;
    provider = mockProvider;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('notifyUser', () => {
    it('should save history and send push if tokens exist', async () => {
      const userId = 'u1';
      const chapterId = 'c1';
      const payload = { title: 'Hello', body: 'World', category: 'CHAT' };

      repo.findTokensByUserId.mockResolvedValue([{ token: 't1' }]);
      repo.getPreferences.mockResolvedValue([
        { category: 'CHAT', isEnabled: true },
      ]);

      await service.notifyUser(userId, chapterId, payload);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId, title: 'Hello' }),
      );
      expect(provider.send).toHaveBeenCalledWith(
        expect.objectContaining({ tokens: ['t1'] }),
      );
    });

    it('should not send push if category is disabled in preferences', async () => {
      const userId = 'u1';
      const chapterId = 'c1';
      const payload = { title: 'Hello', body: 'World', category: 'CHAT' };

      repo.findTokensByUserId.mockResolvedValue([{ token: 't1' }]);
      repo.getPreferences.mockResolvedValue([
        { category: 'CHAT', isEnabled: false },
      ]);

      await service.notifyUser(userId, chapterId, payload);

      expect(repo.create).toHaveBeenCalled(); // History still saved
      expect(provider.send).not.toHaveBeenCalled();
    });
  });
});
