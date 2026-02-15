import { Test, TestingModule } from '@nestjs/testing';
import { ChatService } from './chat.service';
import { CHAT_REPOSITORY } from '../../domain/repositories/chat.repository.interface';
import { NotificationService } from './notification.service';
import { UserService } from './user.service';

describe('ChatService', () => {
  let service: ChatService;
  let chatRepo: {
    findChannelById: jest.Mock;
    createMessage: jest.Mock;
    createChannel: jest.Mock;
  };
  let notificationService: {
    notifyUser: jest.Mock;
  };

  const mockChatRepo = {
    findChannelById: jest.fn(),
    createMessage: jest.fn(),
    createChannel: jest.fn(),
  };

  const mockNotificationService = {
    notifyUser: jest.fn(),
  };

  const mockUserService = {
    findById: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: CHAT_REPOSITORY, useValue: mockChatRepo },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: UserService, useValue: mockUserService },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
    chatRepo = mockChatRepo;
    notificationService = mockNotificationService;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendMessage', () => {
    it('should save message and process mentions', async () => {
      const userId = 'u1';
      const chapterId = 'c1';
      const channelId = 'ch1';
      const mentionedId = '550e8400-e29b-41d4-a716-446655440000';
      const content = `Hello @${mentionedId}`;

      chatRepo.findChannelById.mockResolvedValue({
        id: channelId,
        name: 'General',
      });
      chatRepo.createMessage.mockResolvedValue({ id: 'm1', content });

      await service.sendMessage(userId, chapterId, channelId, content);

      expect(chatRepo.createMessage).toHaveBeenCalled();
      expect(notificationService.notifyUser).toHaveBeenCalledWith(
        mentionedId,
        chapterId,
        expect.objectContaining({ category: 'CHAT' }),
      );
    });
  });
});
