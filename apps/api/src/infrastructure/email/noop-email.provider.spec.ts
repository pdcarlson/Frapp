import { NoopEmailProvider } from './noop-email.provider';

const params = {
  to: 'member@example.com',
  joinUrl: 'https://app.frapp.live/join?token=abc',
  role: 'Member',
};

describe('NoopEmailProvider', () => {
  it('reports success without sending (local / CI default)', async () => {
    const provider = new NoopEmailProvider();

    await expect(provider.sendInviteEmail(params)).resolves.toBe(true);
  });

  it('reports delivery failure when constructed for production', async () => {
    const provider = new NoopEmailProvider(true);

    await expect(provider.sendInviteEmail(params)).resolves.toBe(false);
  });
});
