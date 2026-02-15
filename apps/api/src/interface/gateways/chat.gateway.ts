import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verifyToken } from '@clerk/backend';

interface AuthenticatedSocket extends Socket {
  user: unknown;
  chapterId: string;
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(private readonly configService: ConfigService) {}

  async handleConnection(client: AuthenticatedSocket) {
    const auth = client.handshake.auth as Record<string, unknown> | undefined;
    const query = client.handshake.query as Record<string, unknown> | undefined;
    const token = (auth?.token || query?.token) as string | undefined;
    const chapterId =
      (client.handshake.headers['x-chapter-id'] as string) ||
      (query?.chapterId as string | undefined);

    if (!token || !chapterId) {
      this.logger.warn(
        `Client connection rejected: Missing token or chapterId. Client ID: ${client.id}`,
      );
      client.disconnect();
      return;
    }

    try {
      const payload = (await verifyToken(token, {
        secretKey: this.configService.get<string>('CLERK_SECRET_KEY'),
      })) as Record<string, unknown>;

      // Attach user info to socket
      client.user = payload;
      client.chapterId = chapterId;

      // Join chapter room
      await client.join(`chapter_${chapterId}`);

      this.logger.log(
        `Client connected: ${client.id} | User: ${String(payload.sub)} | Chapter: ${chapterId}`,
      );
    } catch (error) {
      this.logger.error(
        `Connection authentication failed for client ${client.id}`,
        error,
      );
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('joinChannel')
  async handleJoinChannel(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { channelId: string },
  ) {
    // TODO: Verify user has access to this channel via ChatService
    await client.join(`channel_${data.channelId}`);
    return { status: 'joined', channelId: data.channelId };
  }

  @SubscribeMessage('leaveChannel')
  async handleLeaveChannel(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { channelId: string },
  ) {
    await client.leave(`channel_${data.channelId}`);
    return { status: 'left', channelId: data.channelId };
  }

  // This gateway primarily handles real-time broadcasting.
  // Message persistence is handled by the ChatService called from here or REST.

  broadcastMessage(channelId: string, message: any) {
    this.server.to(`channel_${channelId}`).emit('newMessage', message);
  }
}
