import { NoopEmailProvider } from './noop-email.provider';

describe('NoopEmailProvider', () => {
  it('reports success without sending', async () => {
    const provider = new NoopEmailProvider();

    const result = await provider.sendInviteEmail({
      to: 'member@example.com',
      joinUrl: 'https://app.frapp.live/join?token=abc',
      role: 'Member',
    });

    expect(result).toBe(true);
  });
});
