import { Inject, Injectable, Logger } from '@nestjs/common';
import { USER_REPOSITORY } from '../../domain/repositories/user.repository.interface';
import type { IUserRepository } from '../../domain/repositories/user.repository.interface';

export interface ClerkUser {
  id: string;
  email_addresses?: Array<{ email_address: string }>;
}

@Injectable()
export class UserSyncService {
  private readonly logger = new Logger(UserSyncService.name);

  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
  ) {}

  async handleUserCreated(data: ClerkUser): Promise<void> {
    const clerkId = data.id;
    const email = data.email_addresses?.[0]?.email_address;

    if (!clerkId || !email) {
      this.logger.error('Invalid user.created payload: missing id or email', {
        data,
      });
      throw new Error('Invalid payload');
    }

    try {
      await this.userRepository.create({ clerkId, email });
      this.logger.log(`Successfully synced created user: ${clerkId}`);
    } catch (error) {
      this.logger.error(`Failed to sync created user: ${clerkId}`, error);
      throw error;
    }
  }

  async handleUserUpdated(data: ClerkUser): Promise<void> {
    const clerkId = data.id;
    const email = data.email_addresses?.[0]?.email_address;

    if (!clerkId) {
      this.logger.error('Invalid user.updated payload: missing id', { data });
      throw new Error('Invalid payload');
    }

    try {
      const existingUser = await this.userRepository.findByClerkId(clerkId);

      if (existingUser) {
        await this.userRepository.update(clerkId, { email });
        this.logger.log(`Successfully synced updated user: ${clerkId}`);
      } else {
        // Idempotency: If user doesn't exist yet, create them
        this.logger.warn(
          `User ${clerkId} not found during update event. Creating instead.`,
        );
        await this.userRepository.create({ clerkId, email: email ?? '' });
      }
    } catch (error) {
      this.logger.error(`Failed to sync updated user: ${clerkId}`, error);
      throw error;
    }
  }

  async handleUserDeleted(data: Partial<ClerkUser>): Promise<void> {
    const clerkId = data.id;

    if (!clerkId) {
      this.logger.error('Invalid user.deleted payload: missing id', { data });
      throw new Error('Invalid payload');
    }

    try {
      await this.userRepository.delete(clerkId);
      this.logger.log(`Successfully synced deleted user: ${clerkId}`);
    } catch (error) {
      this.logger.error(`Failed to sync deleted user: ${clerkId}`, error);
      throw error;
    }
  }
}
