import { MemberPhoneReachService } from './member-phone-reach.service';
import type { PushToken } from '#domain/entities/notification.entity';

const token = (over: Partial<PushToken>): PushToken => ({
  id: 'pt',
  user_id: 'u-1',
  token: 'ExponentPushToken[secret]',
  device_name: 'ios 26.1 · iPhone 16',
  created_at: '2026-11-01T00:00:00.000Z',
  last_registered_at: '2026-11-18T00:00:00.000Z',
  notifications_enabled: true,
  ...over,
});

describe('MemberPhoneReachService', () => {
  const memberRepo = { findByChapter: jest.fn() };
  const pushTokenRepo = { findByUserIds: jest.fn() };
  const rbacService = { getEffectivePermissions: jest.fn() };
  const service = new MemberPhoneReachService(
    memberRepo as any,
    pushTokenRepo as any,
    rbacService as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    memberRepo.findByChapter.mockResolvedValue([
      { user_id: 'u-1' },
      { user_id: 'u-2' },
      { user_id: 'u-3' },
    ]);
    pushTokenRepo.findByUserIds.mockResolvedValue([
      token({ user_id: 'u-1' }),
      token({ id: 'pt-2', user_id: 'u-2', notifications_enabled: false }),
    ]);
  });

  it('gives an officer who can invite every member, without tokens or labels', async () => {
    rbacService.getEffectivePermissions.mockResolvedValue([
      'members:view',
      'members:invite',
    ]);

    const result = await service.findForViewer('ch-1', 'u-1');

    expect(result.scope).toBe('chapter');
    expect(result.members.map((m) => [m.user_id, m.state])).toEqual([
      ['u-1', 'on'],
      ['u-2', 'off'],
      ['u-3', 'web_only'],
    ]);
    expect(pushTokenRepo.findByUserIds).toHaveBeenCalledWith([
      'u-1',
      'u-2',
      'u-3',
    ]);
    const body = JSON.stringify(result);
    expect(body).not.toContain('ExponentPushToken');
    expect(body).not.toContain('iPhone 16');
  });

  it('gives a member without invite or role rights only their own entry', async () => {
    rbacService.getEffectivePermissions.mockResolvedValue(['members:view']);

    const result = await service.findForViewer('ch-1', 'u-2');

    expect(result).toEqual({
      scope: 'self',
      members: [expect.objectContaining({ user_id: 'u-2', state: 'off' })],
    });
    expect(memberRepo.findByChapter).not.toHaveBeenCalled();
    expect(pushTokenRepo.findByUserIds).toHaveBeenCalledWith(['u-2']);
  });
});
