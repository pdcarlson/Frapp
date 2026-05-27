import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import type { WebSocketLikeConstructor } from '@supabase/realtime-js';
import type { Database, FrappSupabaseClient } from './database.types';

export const SUPABASE_CLIENT = 'SUPABASE_CLIENT';

/**
 * Supabase client provider.
 *
 * Realtime transport: `@supabase/realtime-js` (≥ 2.97) requires native
 * `WebSocket` on the global. Node 22+ ships it; Node 20 does NOT. CI pins
 * Node 20, so instantiating the client without an explicit transport would
 * throw "Node.js 20 detected without native WebSocket support" at startup
 * (and at OpenAPI export time, which silently aborts the api-contract
 * check, blocking PRs that touch any apps/api/src file).
 *
 * The `ws` package is a Realtime-compatible polyfill; we pass it via
 * `realtime.transport` so the same provider works on Node 20 (CI), Node 22
 * (newer hosts), and the Docker image regardless of base version.
 */
export const supabaseProvider: Provider = {
  provide: SUPABASE_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): FrappSupabaseClient => {
    const url = config.getOrThrow<string>('SUPABASE_URL');
    const serviceKey = config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY');

    // `ws.WebSocket` and the browser `WebSocket` differ subtly in their
    // event typings (`event.target` nullability) but the runtime contract
    // Supabase's RealtimeClient cares about matches. Cast to the
    // realtime-js-exported `WebSocketLikeConstructor` so the assignment is
    // type-safe without introducing `any`.
    const transport = WebSocket as unknown as WebSocketLikeConstructor;

    return createClient<Database>(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: { transport },
    });
  },
};
