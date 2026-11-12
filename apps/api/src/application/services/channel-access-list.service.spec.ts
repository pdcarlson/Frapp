import type { Role } from '#domain/entities/role.entity';
import type { IRoleRepository } from '#domain/repositories/role.repository.interface';
import type { IRoleTierRepository } from '#domain/repositories/role-tier.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import type { IChatCategoryRepository } from '#domain/repositories/chat.repository.interface';
import { ChannelAccessListService } from './channel-access-list.service';

function role(id: string, name: string, extra: Partial<Role> = {}): Role {
  return {
    id,
    chapter_id: 'ch-1',
    name,
    system_key: null,
    permissions: [],
    is_system: false,
    display_order: 1,
    color: null,
    mentionable: true,
    tier_id: null,
    permission_overrides: {},
    created_at: '2026-11-12T00:00:00Z',
    ...extra,
  };
}

describe('ChannelAccessListService.listOptions', () => {
  it('marks only the Everyone role hidden, so no list offers to add it (#4191)', async () => {
    const service = new ChannelAccessListService(
      {
        findByChapter: jest
          .fn()
          .mockResolvedValue([
            role('r-everyone', 'Everyone', { system_key: 'MEMBER' }),
            role('r-chair', 'Rush Chair'),
          ]),
      } as unknown as IRoleRepository,
      {
        findByChapter: jest.fn().mockResolvedValue([]),
      } as unknown as IRoleTierRepository,
      {
        findByChapter: jest
          .fn()
          .mockResolvedValue([
            { chapter_id: 'ch-1', user_id: 'u1', role_ids: ['r-everyone'] },
          ]),
      } as unknown as IMemberRepository,
      {} as IChatCategoryRepository,
    );

    const options = await service.listOptions('ch-1');
    expect(
      Object.fromEntries(options.map((option) => [option.name, option.hidden])),
    ).toEqual({ Everyone: true, 'Rush Chair': false });
  });
});
