import { Test } from '@nestjs/testing';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import { NotificationService } from '../../application/services/notification.service';
import { ChatPushWorkerService } from './chat-push-worker.service';
import {
  ChatNotificationPreferenceRepository,
  type ChatNotificationPreferenceRow,
} from './chat-notification-preference.repository';
import { RbacService } from '../../application/services/rbac.service';

describe('ChatPushWorkerService', () => {
  let service: ChatPushWorkerService;
  let notifyUser: jest.Mock;
  let findByChapter: jest.Mock;
  let findForUser: jest.Mock;
  let getEffectivePermissions: jest.Mock;

  const CHANNEL = {
    id: 'ch-1',
    chapter_id: 'chap-1',
    name: 'general',
    is_read_only: false,
    type: 'PUBLIC',
    member_ids: null,
    required_permissions: null,
  };

  const ANNOUNCEMENT_CHANNEL = {
    ...CHANNEL,
    id: 'ch-announce',
    name: 'announcements',
    is_read_only: true,
  };

  beforeEach(async () => {
    notifyUser = jest.fn().mockResolvedValue(undefined);
    findByChapter = jest.fn();
    findForUser = jest.fn().mockResolvedValue([]);
    getEffectivePermissions = jest.fn().mockResolvedValue([]);

    const mod = await Test.createTestingModule({
      providers: [
        ChatPushWorkerService,
        {
          provide: SUPABASE_CLIENT,
          useValue: {},
        },
        {
          provide: MEMBER_REPOSITORY,
          useValue: { findByChapter },
        },
        {
          provide: NotificationService,
          useValue: { notifyUser },
        },
        {
          provide: ChatNotificationPreferenceRepository,
          useValue: { findForUser },
        },
        {
          provide: RbacService,
          useValue: { getEffectivePermissions },
        },
      ],
    }).compile();

    service = mod.get(ChatPushWorkerService);
  });

  function setMembers(userIds: string[]) {
    findByChapter.mockResolvedValue(userIds.map((id) => ({ user_id: id })));
  }

  it('does not push the sender on their own message', async () => {
    service.__setChannelForTest(CHANNEL);
    setMembers(['sender', 'recipient']);
    await service.handleMessage({
      id: 'm1',
      channel_id: CHANNEL.id,
      sender_id: 'sender',
      content: 'hello',
      kind: 'text',
      created_at: '',
    });
    expect(notifyUser).toHaveBeenCalledTimes(0); // mentions tier + no mention
  });

  it('pushes announcements to recipients with the default level', async () => {
    service.__setChannelForTest(ANNOUNCEMENT_CHANNEL);
    setMembers(['sender', 'a', 'b']);
    await service.handleMessage({
      id: 'm1',
      channel_id: ANNOUNCEMENT_CHANNEL.id,
      sender_id: 'sender',
      content: 'Big news',
      kind: 'announcement',
      created_at: '',
    });
    expect(notifyUser).toHaveBeenCalledTimes(2);
    expect(notifyUser).toHaveBeenCalledWith(
      'a',
      'chap-1',
      expect.objectContaining({
        title: 'New Announcement',
        priority: 'URGENT',
        category: 'announcements',
      }),
    );
  });

  it('skips recipients currently in the channel (presence)', async () => {
    service.__setChannelForTest(ANNOUNCEMENT_CHANNEL);
    service.__setPresenceForTest(ANNOUNCEMENT_CHANNEL.id, ['a']);
    setMembers(['sender', 'a', 'b']);
    await service.handleMessage({
      id: 'm1',
      channel_id: ANNOUNCEMENT_CHANNEL.id,
      sender_id: 'sender',
      content: 'Big news',
      kind: 'announcement',
      created_at: '',
    });
    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(notifyUser).toHaveBeenCalledWith('b', 'chap-1', expect.any(Object));
  });

  it('honors a per-channel off preference', async () => {
    service.__setChannelForTest(ANNOUNCEMENT_CHANNEL);
    setMembers(['sender', 'a']);
    const pref: ChatNotificationPreferenceRow = {
      user_id: 'a',
      chapter_id: 'chap-1',
      scope: 'channel',
      scope_id: ANNOUNCEMENT_CHANNEL.id,
      scope_kind: null,
      level: 'off',
    };
    findForUser.mockResolvedValue([pref]);
    await service.handleMessage({
      id: 'm1',
      channel_id: ANNOUNCEMENT_CHANNEL.id,
      sender_id: 'sender',
      content: 'Big news',
      kind: 'announcement',
      created_at: '',
    });
    expect(notifyUser).toHaveBeenCalledTimes(0);
  });

  it('pushes a per-channel off recipient when they are @mentioned (mute override)', async () => {
    service.__setChannelForTest(CHANNEL);
    setMembers(['sender', 'a']);
    const pref: ChatNotificationPreferenceRow = {
      user_id: 'a',
      chapter_id: 'chap-1',
      scope: 'channel',
      scope_id: CHANNEL.id,
      scope_kind: null,
      level: 'off',
    };
    findForUser.mockResolvedValue([pref]);
    // `mentions` is a `users.id[]` column on `chat_messages`, resolved by the
    // API at send time (C1 of #937).
    //
    // This test used to build `{ a: true }` and pass, because the worker read
    // the field through a structural cast typed as a map — but no row has ever
    // carried it, since the column did not exist. So the mute override was
    // green here and had never fired once in production. Use the real shape.
    const row = {
      id: 'm1',
      channel_id: CHANNEL.id,
      sender_id: 'sender',
      content: 'hey @a can you cover tonight?',
      kind: 'text',
      created_at: '',
      mentions: ['a'],
    };
    await service.handleMessage(row);
    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(notifyUser).toHaveBeenCalledWith('a', 'chap-1', expect.any(Object));
  });

  it('suppresses system_audit unless the user opted in', async () => {
    service.__setChannelForTest({
      ...CHANNEL,
      id: 'ch-audit',
      name: 'chapter-audit',
      is_read_only: true,
    });
    setMembers(['sender', 'a']);
    await service.handleMessage({
      id: 'm1',
      channel_id: 'ch-audit',
      sender_id: 'sender',
      content: 'config changed',
      kind: 'system_audit',
      created_at: '',
    });
    expect(notifyUser).toHaveBeenCalledTimes(0);
  });

  it('bundles a burst into a single push at the threshold', async () => {
    service.__setChannelForTest(ANNOUNCEMENT_CHANNEL);
    setMembers(['sender', 'a']);
    for (let i = 0; i < 4; i++) {
      await service.handleMessage({
        id: `m${i}`,
        channel_id: ANNOUNCEMENT_CHANNEL.id,
        sender_id: 'sender',
        content: `msg ${i}`,
        kind: 'announcement',
        created_at: '',
      });
    }
    // Push 1 + Push 2 + Bundled push = 3; the 4th is skipped (within bundle).
    expect(notifyUser).toHaveBeenCalledTimes(3);
    const bundledCall = notifyUser.mock.calls[2];
    expect(bundledCall[2]).toEqual(
      expect.objectContaining({
        body: '3 new messages',
        data: expect.objectContaining({ bundled: true, count: 3 }),
      }),
    );
  });
  it('does not push a private channel to a chapter member who is not in it', async () => {
    // The recipient list starts as the whole chapter roster, and `decidePush`
    // returns 'send' on a mention *before* the level check — so without a read
    // filter, mentioning a non-member in a DM would hand them a 200-character
    // preview of its body plus a persisted notification row, overriding even an
    // explicit `off`. This was inert until mentions resolved for real (C1).
    service.__setChannelForTest({
      id: 'dm-1',
      chapter_id: 'chap-1',
      name: 'alice-bob',
      is_read_only: false,
      type: 'DM',
      member_ids: ['alice', 'bob'],
      required_permissions: null,
    });
    setMembers(['alice', 'bob', 'carol']);
    findForUser.mockResolvedValue([]);

    await service.handleMessage({
      id: 'm1',
      channel_id: 'dm-1',
      sender_id: 'alice',
      content: 'do not tell @carol we are cutting her',
      kind: 'text',
      created_at: '',
      mentions: ['carol'],
    });

    const notified = notifyUser.mock.calls.map((c) => c[0]);
    expect(notified).not.toContain('carol');
  });

  it('still pushes a DM to the other participant', async () => {
    // The filter must not silence the channel it is protecting.
    service.__setChannelForTest({
      id: 'dm-1',
      chapter_id: 'chap-1',
      name: 'alice-bob',
      is_read_only: false,
      type: 'DM',
      member_ids: ['alice', 'bob'],
      required_permissions: null,
    });
    setMembers(['alice', 'bob', 'carol']);

    await service.handleMessage({
      id: 'm1',
      channel_id: 'dm-1',
      sender_id: 'alice',
      content: 'hey @bob',
      kind: 'text',
      created_at: '',
      mentions: ['bob'],
    });

    expect(notifyUser.mock.calls.map((c) => c[0])).toEqual(['bob']);
  });

  it('gates a ROLE_GATED channel on the recipient holding the permission', async () => {
    service.__setChannelForTest({
      id: 'ch-exec',
      chapter_id: 'chap-1',
      name: 'exec',
      is_read_only: false,
      type: 'ROLE_GATED',
      member_ids: null,
      required_permissions: ['exec:view'],
    });
    setMembers(['sender', 'officer', 'pledge']);
    getEffectivePermissions.mockImplementation(async (_chap, uid) =>
      uid === 'officer' ? ['exec:view'] : [],
    );

    await service.handleMessage({
      id: 'm1',
      channel_id: 'ch-exec',
      sender_id: 'sender',
      content: 'heads up @pledge @officer',
      kind: 'text',
      created_at: '',
      mentions: ['pledge', 'officer'],
    });

    expect(notifyUser.mock.calls.map((c) => c[0])).toEqual(['officer']);
  });
});
