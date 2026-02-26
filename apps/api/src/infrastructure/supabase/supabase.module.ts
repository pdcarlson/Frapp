import { Global, Module } from '@nestjs/common';
import { supabaseProvider, SUPABASE_CLIENT } from './supabase.provider';

@Global()
@Module({
  providers: [supabaseProvider],
  exports: [SUPABASE_CLIENT],
})
export class SupabaseModule {}
