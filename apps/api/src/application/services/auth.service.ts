import { Inject, Injectable } from '@nestjs/common';
import { USER_REPOSITORY } from '../../domain/repositories/user.repository.interface';
import type { IUserRepository } from '../../domain/repositories/user.repository.interface';

@Injectable()
export class AuthService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepo: IUserRepository,
  ) {}

  async syncUser(
    supabaseAuthId: string,
    email: string,
  ): Promise<{ id: string }> {
    const existing = await this.userRepo.findBySupabaseAuthId(supabaseAuthId);
    if (existing) return { id: existing.id };

    const user = await this.userRepo.create({
      supabase_auth_id: supabaseAuthId,
      email,
      display_name: email.split('@')[0],
    });
    return { id: user.id };
  }
}
