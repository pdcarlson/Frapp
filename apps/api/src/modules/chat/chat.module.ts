import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { UserModule } from '../user/user.module';
import { NotificationModule } from '../notification/notification.module';
import { CHAT_REPOSITORY } from '../../domain/repositories/chat.repository.interface';
import { DrizzleChatRepository } from '../../infrastructure/database/repositories/drizzle-chat.repository';
import { ChatService } from '../../application/services/chat.service';
import { ChatGateway } from '../../interface/gateways/chat.gateway';
import { ChatController } from '../../interface/controllers/chat.controller';

@Module({
  imports: [DatabaseModule, UserModule, NotificationModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    ChatGateway,
    {
      provide: CHAT_REPOSITORY,
      useClass: DrizzleChatRepository,
    },
  ],
  exports: [ChatService, ChatGateway],
})
export class ChatModule {}
