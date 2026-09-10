import { Logger } from '@nestjs/common';
import { ResendEmailProvider } from './resend-email.provider';

describe('ResendEmailProvider', () => {
  const params = {
    to: 'member@example.com',
    joinUrl: 'https://app.frapp.live/join?token=abc',
    role: 'Member',
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends via the Resend API and reports success on a 2xx response', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));

    const provider = new ResendEmailProvider({
      apiKey: 're_test',
      fromAddress: 'Signet <invites@mail.frapp.live>',
    });

    const result = await provider.sendInviteEmail(params);

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer re_test',
        }),
      }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.from).toBe('Signet <invites@mail.frapp.live>');
    expect(body.to).toBe(params.to);
    expect(body.subject).toBe("You're invited to join a chapter on Signet");
    expect(body.html).toContain('join a chapter on Signet');
    expect(body.text).toContain('join a chapter on Signet');
    expect(body.subject).not.toContain('Frapp');
    expect(body.html).toContain(params.joinUrl);
  });

  it('reports failure on a non-2xx response without throwing', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(null, { status: 422, statusText: 'Unprocessable' }),
      );

    const provider = new ResendEmailProvider({
      apiKey: 're_test',
      fromAddress: 'Signet <invites@mail.frapp.live>',
    });

    const result = await provider.sendInviteEmail(params);

    expect(result).toBe(false);
  });

  it('reports failure and swallows a network error', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    const provider = new ResendEmailProvider({
      apiKey: 're_test',
      fromAddress: 'Signet <invites@mail.frapp.live>',
    });

    await expect(provider.sendInviteEmail(params)).resolves.toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]).toHaveLength(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain(
      'Resend invite email send failed',
    );
    expect(String(warnSpy.mock.calls[0][0])).toContain('network down');
    expect(String(warnSpy.mock.calls[0][0])).not.toContain(params.joinUrl);
    expect(String(warnSpy.mock.calls[0][0])).not.toContain(params.to);
  });

  it('escapes HTML in the role name', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));

    const provider = new ResendEmailProvider({
      apiKey: 're_test',
      fromAddress: 'Signet <invites@mail.frapp.live>',
    });

    await provider.sendInviteEmail({
      ...params,
      role: '<script>alert(1)</script>',
    });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.html).not.toContain('<script>');
    expect(body.html).toContain('&lt;script&gt;');
  });
});
