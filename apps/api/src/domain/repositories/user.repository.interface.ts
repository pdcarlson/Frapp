import { User } from '../entities/user.entity';

export const USER_REPOSITORY = 'USER_REPOSITORY';

export interface IUserRepository {
  create(user: { clerkId: string; email: string }): Promise<User>;
  update(
    clerkId: string,
    user: Partial<{ email: string }>,
  ): Promise<User>;
  delete(clerkId: string): Promise<void>;
  findByClerkId(clerkId: string): Promise<User | null>;
}
