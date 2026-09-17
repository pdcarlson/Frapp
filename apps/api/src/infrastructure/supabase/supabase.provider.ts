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
 * `WebSocket` on the global. Node 22+ ships it; Node 20 does NOT. That gap is
 * no longer live — CI and the Dockerfile both run Node 24 now — but the
 * explicit transport stays, because the failure it prevents is silent where it
 * matters: without one, a runtime that lacks the global throws "Node.js 20
 * detected without native WebSocket support" at startup AND at OpenAPI export
 * time, where it aborts the api-contract check and blocks every PR touching
 * apps/api/src.
 *
 * The `ws` package is a Realtime-compatible polyfill; passing it via
 * `realtime.transport` pins one transport across CI, the Docker image and a
 * dev machine, rather than letting the base image's Node version decide.
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
