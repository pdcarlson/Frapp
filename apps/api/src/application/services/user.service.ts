import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { USER_REPOSITORY } from '../../domain/repositories/user.repository.interface';
import type { IUserRepository } from '../../domain/repositories/user.repository.interface';
import { User } from '../../domain/entities/user.entity';

@Injectable()
export class UserService {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
  ) {}

  async findByClerkId(clerkId: string): Promise<User> {
    const user = await this.userRepository.findByClerkId(clerkId);
    if (!user) {
      throw new NotFoundException(`User with Clerk ID ${clerkId} not found`);
    }
    return user;
  }
}
