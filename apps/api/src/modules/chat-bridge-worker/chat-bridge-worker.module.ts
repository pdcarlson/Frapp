import { Module } from '@nestjs/common';
import { ChatBridgeWorkerService } from './chat-bridge-worker.service';

/**
 * Audit→chat bridge worker (ADR-08). Runs in-process on the API; the
 * `OnApplicationBootstrap` lifecycle on `ChatBridgeWorkerService` opens
 * the Supabase Realtime subscription. The Supabase client is provided
 * globally via `SupabaseModule`, so this module only needs to register
 * the service.
 */
@Module({
  providers: [ChatBridgeWorkerService],
})
export class ChatBridgeWorkerModule {}
