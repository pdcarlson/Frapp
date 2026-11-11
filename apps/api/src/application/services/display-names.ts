import type { IUserRepository } from '#domain/repositories/user.repository.interface';

/**
 * Display names by user id, for list rows that name a member. An id with no
 * user row is simply absent, and a missing name reads as empty: names are
 * never invented (the roster's convention).
 */
export async function displayNamesById(
  userRepo: IUserRepository,
  userIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return new Map();
  const users = await userRepo.findDisplayIdentitiesByIds(unique);
  return new Map(users.map((user) => [user.id, user.display_name ?? '']));
}
