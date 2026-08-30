import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';

// Same shape `all-exceptions.filter.spec.ts` uses.
jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));
const captureException = Sentry.captureException as jest.Mock;
import {
  DEFAULT_RETURN_PATH,
  DiscordOAuthService,
  safeReturnPath,
} from './discord-oauth.service';
import {
  DISCORD_BOT_GATEWAY,
  DISCORD_OAUTH_CLIENT,
} from '../../domain/adapters/discord.interface';
import { DISCORD_CONNECTION_REPOSITORY } from '../../domain/repositories/discord-connection.repository.interface';
import type { DiscordOAuthState } from '../../domain/entities/discord-connection.entity';

const CHAPTER = 'chapter-1';
const OTHER_CHAPTER = 'chapter-2';
const USER = 'user-1';
const GUILD = '800000000000000001';
const STATE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW = new Date('2026-08-24T12:00:00Z');

/** Manage Server (1 << 5). */
const MANAGE_GUILD = String(1n << 5n);
/** Administrator (1 << 3). */
const ADMINISTRATOR = String(1n << 3n);
/** Send Messages (1 << 11) — a real permission that is not enough. */
const SEND_MESSAGES = String(1n << 11n);

/**
 * What the repository actually throws when the table is not there.
 *
 * Verbatim PostgREST, and deliberately NOT an `Error`: `postgrest-js`
 * constructs a real `PostgrestError` only under `shouldThrowOnError`, which
 * nothing in this codebase enables, so `if (error) throw error` rethrows the
 * parsed response body as a plain object. This is the exact payload the
 * deployed staging incident produced.
 */
const PGRST_TABLE_MISSING = {
  code: 'PGRST205',
  details: null,
  hint: "Perhaps you meant the table 'public.discord_oauth_states'",
  message:
    "Could not find the table 'public.discord_oauth_states' in the schema cache",
};

function stateRow(
  overrides: Partial<DiscordOAuthState> = {},
): DiscordOAuthState {
  return {
    id: STATE,
    chapter_id: CHAPTER,
    created_by: USER,
    return_path: DEFAULT_RETURN_PATH,
    expires_at: new Date(NOW.getTime() + 60_000).toISOString(),
    consumed_at: null,
    created_at: NOW.toISOString(),
    pending_guild_id: null,
    pending_guild_name: null,
    pending_guild_icon: null,
    pending_discord_user_id: null,
    pending_discord_username: null,
    pending_permissions: null,
    pending_scopes: null,
    confirm_token: null,
    confirm_expires_at: null,
    confirmed_at: null,
    ...overrides,
  };
}

let repo: Record<string, jest.Mock>;
let oauth: Record<string, jest.Mock>;
let bot: Record<string, jest.Mock>;

async function build(config: Record<string, string | undefined> = {}) {
  repo = {
    findByChapter: jest.fn(async () => null),
    upsert: jest.fn(async (input: Record<string, unknown>) => ({
      id: 'conn-1',
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
      ...input,
    })),
    deleteByChapter: jest.fn(async () => true),
    createState: jest.fn(async () => stateRow()),
    consumeState: jest.fn(async () => stateRow()),
    attachPendingConnection: jest.fn(async () => stateRow()),
    consumeConfirmToken: jest.fn(async () =>
      stateRow({
        pending_guild_id: GUILD,
        pending_guild_name: 'Tau Nu',
        pending_discord_user_id: '2000000000000000002',
        pending_discord_username: 'Paul',
        pending_permissions: MANAGE_GUILD,
        pending_scopes: 'bot identify guilds',
      }),
    ),
    deleteExpiredStates: jest.fn(async () => 0),
  };
  oauth = {
    isConfigured: jest.fn(() => true),
    buildAuthorizeUrl: jest.fn(
      ({ state, redirectUri }: { state: string; redirectUri: string }) =>
        `https://discord.com/oauth2/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    ),
    exchangeCode: jest.fn(async () => ({
      accessToken: 'user-token',
      scope: 'bot identify guilds',
      guild: { id: GUILD, name: 'Tau Nu', icon: null },
    })),
    fetchAuthorizingUser: jest.fn(async () => ({
      id: '2000000000000000002',
      username: 'Paul',
    })),
    fetchUserGuilds: jest.fn(async () => [
      { id: GUILD, name: 'Tau Nu', permissions: MANAGE_GUILD, owner: false },
    ]),
    revokeToken: jest.fn(async () => undefined),
  };
  bot = { isConfigured: jest.fn(() => true) };

  const settings: Record<string, string | undefined> = {
    API_URL: 'https://api.example.test',
    APP_URL: 'https://app.example.test',
    ...config,
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      DiscordOAuthService,
      { provide: DISCORD_CONNECTION_REPOSITORY, useValue: repo },
      { provide: DISCORD_OAUTH_CLIENT, useValue: oauth },
      { provide: DISCORD_BOT_GATEWAY, useValue: bot },
      {
        provide: ConfigService,
        useValue: { get: (key: string) => settings[key] },
      },
    ],
  }).compile();
  return moduleRef.get(DiscordOAuthService);
}

describe('DiscordOAuthService — availability', () => {
  it('is unavailable when any one of the four settings is missing', async () => {
    // Three of four is not a degraded mode, it is a flow that strands the admin
    // on a Discord page with nowhere to come back to.
    for (const missing of ['API_URL', 'APP_URL'] as const) {
      const service = await build({ [missing]: undefined });
      expect(service.isAvailable()).toBe(false);
    }

    const noClient = await build();
    oauth.isConfigured.mockReturnValue(false);
    expect(noClient.isAvailable()).toBe(false);

    const noBot = await build();
    bot.isConfigured.mockReturnValue(false);
    expect(noBot.isAvailable()).toBe(false);
  });

  it('refuses to begin a connect it cannot finish', async () => {
    const service = await build({ APP_URL: undefined });
    await expect(
      service.beginConnect(CHAPTER, USER, null),
    ).rejects.toMatchObject({ status: 503 });
    expect(repo.createState).not.toHaveBeenCalled();
  });
});

describe('DiscordOAuthService — beginConnect', () => {
  it('mints the state before handing out the URL', async () => {
    const service = await build();
    const result = await service.beginConnect(CHAPTER, USER, null);

    expect(repo.createState).toHaveBeenCalledWith(
      expect.objectContaining({ chapter_id: CHAPTER, created_by: USER }),
    );
    expect(result.authorize_url).toContain(`state=${STATE}`);
    // The redirect URI is derived from API_URL plus the fixed path, because
    // Discord matches it against the Developer Portal entry exactly.
    expect(result.authorize_url).toContain(
      encodeURIComponent(
        'https://api.example.test/v1/discord/connect/callback',
      ),
    );
  });

  it('stores a sanitised return path, not whatever the caller sent', async () => {
    const service = await build();
    await service.beginConnect(CHAPTER, USER, '//evil.example.com/phish');
    expect(repo.createState).toHaveBeenCalledWith(
      expect.objectContaining({ return_path: DEFAULT_RETURN_PATH }),
    );
  });
});

describe('DiscordOAuthService — the callback’s trust boundary', () => {
  it('takes the guild from the token exchange, never from the query string', async () => {
    const service = await build();
    // The browser claims a different guild. It must be ignored entirely: the
    // callback reads `guild` off the server-to-server token response.
    const outcome = await service.handleCallback({
      code: 'one-time-code',
      state: STATE,
      // A forged `guild_id` is not even a parameter this method accepts —
      // that is the point. Assert the parked value came from the exchange.
    });

    expect(outcome.code).toBe('pending');
    expect(repo.attachPendingConnection).toHaveBeenCalledWith(
      STATE,
      expect.objectContaining({ guild_id: GUILD }),
    );
  });

  it('BINDS NOTHING — it parks, and hands the browser a confirm token', async () => {
    // The whole confused-deputy fix. Discord proves a Manage Server human
    // installed the bot somewhere; it does not prove they meant THIS chapter to
    // read it, and minting a state is an ordinary action for any officer in any
    // tenant. So the callback must not write a connection.
    const service = await build();

    const outcome = await service.handleCallback({ code: 'c', state: STATE });

    expect(repo.upsert).not.toHaveBeenCalled();
    expect(outcome.code).toBe('pending');
    const token = new URL(outcome.returnUrl).searchParams.get('handshake');
    expect(token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    // The token is NOT the state — re-using the state would leave the hole
    // exactly where it was, because the attacker minted the state.
    expect(token).not.toBe(STATE);
  });

  it('parks against the state row, which the callback cannot supply', async () => {
    const service = await build();
    repo.consumeState.mockResolvedValue(
      stateRow({ id: STATE, chapter_id: OTHER_CHAPTER }),
    );

    await service.handleCallback({ code: 'c', state: STATE });

    // No header, no session, no body — the chapter can only come from here.
    expect(repo.attachPendingConnection).toHaveBeenCalledWith(
      STATE,
      expect.anything(),
    );
  });

  it('refuses a state the repository would not spend', async () => {
    const service = await build();
    repo.consumeState.mockResolvedValue(null);

    const outcome = await service.handleCallback({ code: 'c', state: STATE });

    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('expired');
    expect(repo.attachPendingConnection).not.toHaveBeenCalled();
  });

  it('REDIRECTS rather than throwing when the handshake store fails', async () => {
    // Found on deployed staging, not here: the callback answered a raw 500 to a
    // browser that had just completed an OAuth handshake, because
    // `consumeState` was awaited outside the try/catch and the environment's
    // migration had not been promoted yet — so the table it queries did not
    // exist. Any repository failure does this: a transient PostgREST error, an
    // exhausted pool, a schema behind the code.
    //
    // This method's whole contract is that it RETURNS where to send the
    // browser. A mocked repository that always resolves never exercises the
    // path where it rejects, which is why the suite was green while staging
    // was not.
    //
    // The rejected value is the shape PostgREST ACTUALLY produces, which is the
    // second half of the same lesson. `postgrest-js` builds a real
    // `PostgrestError` only under `shouldThrowOnError`, which nothing here
    // sets, so what the repository rethrows is the parsed body: a plain object,
    // not an `Error`. Rejecting with `new Error(...)` would keep this test
    // green while exercising a branch production never reaches.
    const service = await build();
    repo.consumeState.mockRejectedValue(PGRST_TABLE_MISSING);

    const outcome = await service.handleCallback({ code: 'c', state: STATE });

    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('failed');
    // The code on the query string is the one the dashboard actually reads —
    // the controller returns only `returnUrl` — so assert it there too, not
    // just on the field.
    const url = new URL(outcome.returnUrl);
    expect(url.origin).toBe('https://app.example.test');
    expect(url.searchParams.get('discord')).toBe('failed');
    expect(repo.attachPendingConnection).not.toHaveBeenCalled();
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('LOGS the cause, which a plain PostgREST object all but hides', async () => {
    // The redirect is only half the fix. If the browser is told nothing and the
    // log is told nothing either, a promoted-schema regression is invisible
    // from both ends — so this asserts the one place the cause survives.
    //
    // `error instanceof Error ? error.stack : undefined` passes `undefined`
    // here, and Nest's ConsoleLogger drops a falsy stack silently. `hint` is
    // the field that names the actual problem, so it is what the test demands.
    const service = await build();
    repo.consumeState.mockRejectedValue(PGRST_TABLE_MISSING);
    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await service.handleCallback({ code: 'c', state: STATE });

    expect(logged).toHaveBeenCalledTimes(1);
    const [message, cause] = logged.mock.calls[0] as [string, string];

    // This assertion was inverted by #1260, deliberately. It previously read
    // `expect(message).toContain(STATE)`. The state id is the CSRF token, and
    // on this branch it is *live* — `consumeState` rejected, so the conditional
    // UPDATE never committed and the row stays unspent for the rest of its TTL.
    // Logging it put an unspent handshake id into the application log stream.
    //
    // Nothing this test is actually about is lost: its subject is that the
    // *cause* survives where a plain PostgREST object would hide it, and both
    // cause assertions below are untouched. The id was never diagnostic here —
    // the service's own comment notes this branch is a function of store health
    // alone and fires identically for every state id.
    expect(message).not.toContain(STATE);
    expect(cause).toContain('PGRST205');
    expect(cause).toContain('public.discord_oauth_states');
    logged.mockRestore();
  });

  it('keeps the handshake id out of the log when parking fails', async () => {
    // The third route into the log stream that #1260 found, and the only one
    // of the three that no test pinned: reinstating the id in
    // `parkConnection`'s throw message leaves the rest of this suite green.
    //
    // The catch interpolates `error.message` into a `logger.log` line *and*
    // returns it as the user-facing `reason`, so an id there reaches the
    // application log and the browser. Unlike the `consumeState` branch the
    // state here IS spent, which lowers the severity but not the rule: the
    // handshake id is a credential and the chapter id is what identifies the
    // event.
    const service = await build();
    repo.attachPendingConnection.mockResolvedValue(null);
    const logged = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    const outcome = await service.handleCallback({ code: 'c', state: STATE });

    const messages = logged.mock.calls.map((call) => String(call[0]));
    // Prove the branch was actually taken — otherwise the assertions below
    // pass vacuously on a path that never ran.
    expect(messages.some((m) => m.includes('could not be parked'))).toBe(true);
    for (const message of messages) expect(message).not.toContain(STATE);
    expect(outcome.reason).not.toContain(STATE);
    expect(outcome.returnUrl).not.toContain(STATE);
    logged.mockRestore();
  });

  it('does NOT tell a store failure that its link expired', async () => {
    // These two must not collapse together, which is the opposite of what this
    // test asserted when it was written.
    //
    // `expired` renders as "that link had expired or was already used — start
    // the connection again". Under a store failure both halves are false: the
    // conditional UPDATE never committed, so the state is neither spent nor out
    // of time. And the prescribed recovery is the one thing that cannot work,
    // because starting again writes a NEW state row to the same table that just
    // refused one — so the admin loops, re-authorizing on Discord each time.
    const service = await build();

    repo.consumeState.mockResolvedValue(null);
    const expired = await service.handleCallback({ code: 'c', state: STATE });

    // A network failure rather than a schema one, and again in the shape
    // postgrest-js really hands back: its fetch-rejection branch also produces
    // a plain object, not a `TypeError`.
    repo.consumeState.mockRejectedValue({
      code: '',
      details: 'TypeError: fetch failed',
      hint: '',
      message: 'connection terminated',
    });
    const failed = await service.handleCallback({ code: 'c', state: STATE });

    expect(expired.code).toBe('expired');
    expect(failed.code).toBe('failed');
    expect(failed.returnUrl).not.toBe(expired.returnUrl);
    // Both still end at the dashboard: telling the causes apart must not turn
    // one of them into an unhandled throw or an off-site redirect.
    expect(new URL(failed.returnUrl).origin).toBe('https://app.example.test');
  });

  it('REPORTS the failure it swallows, or nobody ever learns of it', async () => {
    // The redirect is the fix for the admin and, by itself, a regression for
    // the operator. `AllExceptionsFilter` is the only `captureException` in the
    // API and it fires on `status >= 500`, so alerting was coupled to the user
    // seeing an error page — and this change removes the error page. Without
    // the explicit capture, every Discord connect could fail while the 5xx rate
    // stayed flat and Sentry stayed empty.
    const service = await build();
    captureException.mockClear();
    repo.consumeState.mockRejectedValue(PGRST_TABLE_MISSING);

    await service.handleCallback({ code: 'c', state: STATE });

    expect(captureException).toHaveBeenCalledTimes(1);
    const [reported, options] = captureException.mock.calls[0] as [
      Error,
      { tags: Record<string, string> },
    ];
    // `new Error(String(plainObject))` would report "[object Object]" — the
    // cause has to survive into the message.
    expect(reported.message).toContain('PGRST205');
    expect(options.tags.swallowed_as).toBe('failed');
  });

  it('reports the hint but never the offending row values', async () => {
    // `hint` is the half that answers the question, so it has to survive.
    // `details` is where Postgres puts the values that broke the constraint,
    // and this path sends its message to Sentry — where `redactFreeText` is
    // best-effort by its own docblock and lets a phone number through. The
    // constraint is already named in `message`, so `details` buys nothing worth
    // that. See `reportable-error.ts`.
    const service = await build();
    captureException.mockClear();
    repo.consumeState.mockRejectedValue({
      code: '23505',
      message: 'duplicate key value violates unique constraint "x_phone_key"',
      details: 'Key (phone)=(+1-555-0142) already exists.',
      hint: 'Perhaps you meant to update the existing row',
    });

    await service.handleCallback({ code: 'c', state: STATE });

    const [reported] = captureException.mock.calls[0] as [Error];
    expect(reported.message).toContain('23505');
    expect(reported.message).toContain('Perhaps you meant to update');
    expect(reported.message).not.toContain('+1-555-0142');
  });

  it('separating the two opens no state-existence oracle', async () => {
    // The reason `expired` collapses nonexistent, spent and out-of-time
    // together is that telling them apart would let anyone holding a callback
    // URL probe which state ids are real. Splitting `failed` out does not
    // reopen that, and this pins why: the store-failure branch is a function of
    // store HEALTH, never of whether the id resolves — so it answers the same
    // way for a fabricated id as for a live one.
    const service = await build();
    repo.consumeState.mockRejectedValue(PGRST_TABLE_MISSING);

    const real = await service.handleCallback({ code: 'c', state: STATE });
    const fabricated = await service.handleCallback({
      code: 'c',
      state: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });

    expect(fabricated.code).toBe(real.code);
    expect(fabricated.returnUrl).toBe(real.returnUrl);
  });

  it('does not even ask the repository about a non-uuid state', async () => {
    const service = await build();
    const outcome = await service.handleCallback({
      code: 'c',
      state: "' or 1=1--",
    });
    expect(outcome.code).toBe('expired');
    expect(repo.consumeState).not.toHaveBeenCalled();
  });

  it('spends the state even when Discord reports a denial', async () => {
    // Otherwise a cancelled attempt leaves a live state that could be replayed
    // later with a code obtained some other way.
    const service = await build();
    const outcome = await service.handleCallback({
      state: STATE,
      error: 'access_denied',
    });

    expect(repo.consumeState).toHaveBeenCalledWith(STATE, expect.any(Date));
    expect(outcome.code).toBe('declined');
    expect(repo.attachPendingConnection).not.toHaveBeenCalled();
  });

  it('rejects an authorization that installed the bot nowhere', async () => {
    const service = await build();
    oauth.exchangeCode.mockResolvedValue({
      accessToken: 't',
      scope: 'identify guilds',
      guild: null,
    });

    const outcome = await service.handleCallback({ code: 'c', state: STATE });

    expect(outcome.code).toBe('no_guild');
    expect(repo.attachPendingConnection).not.toHaveBeenCalled();
  });
});

describe('DiscordOAuthService — proving the human runs the server', () => {
  it('accepts Manage Server', async () => {
    const service = await build();
    const outcome = await service.handleCallback({ code: 'c', state: STATE });
    expect(outcome.code).toBe('pending');
  });

  it('accepts Administrator', async () => {
    const service = await build();
    oauth.fetchUserGuilds.mockResolvedValue([
      { id: GUILD, name: 'Tau Nu', permissions: ADMINISTRATOR, owner: false },
    ]);
    const outcome = await service.handleCallback({ code: 'c', state: STATE });
    expect(outcome.code).toBe('pending');
  });

  it('accepts the guild owner, whose bitfield can omit the flags', async () => {
    const service = await build();
    oauth.fetchUserGuilds.mockResolvedValue([
      { id: GUILD, name: 'Tau Nu', permissions: '0', owner: true },
    ]);
    const outcome = await service.handleCallback({ code: 'c', state: STATE });
    expect(outcome.code).toBe('pending');
  });

  it('REFUSES an ordinary member of the server', async () => {
    // The core of the whole flow: being in a server is not administering it.
    // Without this, anyone who could reach a chapter's authorize URL could
    // attach a Discord community that never agreed to be read.
    const service = await build();
    oauth.fetchUserGuilds.mockResolvedValue([
      { id: GUILD, name: 'Tau Nu', permissions: SEND_MESSAGES, owner: false },
    ]);

    const outcome = await service.handleCallback({ code: 'c', state: STATE });

    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('no_permission');
    expect(repo.attachPendingConnection).not.toHaveBeenCalled();
  });

  it('REFUSES when the authorizer administers a DIFFERENT server', async () => {
    // Manage Server somewhere else is not Manage Server here. The membership
    // has to be matched by guild id, not merely be present in the list.
    const service = await build();
    oauth.fetchUserGuilds.mockResolvedValue([
      {
        id: '999999999',
        name: 'Other',
        permissions: ADMINISTRATOR,
        owner: true,
      },
    ]);

    const outcome = await service.handleCallback({ code: 'c', state: STATE });

    expect(outcome.code).toBe('not_member');
    expect(repo.attachPendingConnection).not.toHaveBeenCalled();
  });

  it('reads the bitfield as BigInt, so a past-2^53 flag is not rounded away', async () => {
    const service = await build();
    // Manage Server set alongside a very high bit. Number() would lose the
    // low bits entirely and decide this user has no permissions.
    const huge = String((1n << 5n) | (1n << 60n));
    oauth.fetchUserGuilds.mockResolvedValue([
      { id: GUILD, name: 'Tau Nu', permissions: huge, owner: false },
    ]);

    const outcome = await service.handleCallback({ code: 'c', state: STATE });
    expect(outcome.code).toBe('pending');
  });

  it('treats an unparseable bitfield as no permission', async () => {
    const service = await build();
    oauth.fetchUserGuilds.mockResolvedValue([
      { id: GUILD, name: 'Tau Nu', permissions: 'not-a-number', owner: false },
    ]);

    const outcome = await service.handleCallback({ code: 'c', state: STATE });
    expect(outcome.code).toBe('no_permission');
  });

  it('revokes the user token once the two reads are done', async () => {
    const service = await build();
    await service.handleCallback({ code: 'c', state: STATE });
    expect(oauth.revokeToken).toHaveBeenCalledWith('user-token');
  });

  it('revokes the token even when the permission check refuses', async () => {
    const service = await build();
    oauth.fetchUserGuilds.mockResolvedValue([
      { id: GUILD, name: 'Tau Nu', permissions: SEND_MESSAGES, owner: false },
    ]);
    await service.handleCallback({ code: 'c', state: STATE });
    expect(oauth.revokeToken).toHaveBeenCalledWith('user-token');
  });
});

describe('DiscordOAuthService — the confirm step (the confused-deputy fix)', () => {
  /**
   * The attack this closes, replayed end to end.
   *
   * An attacker self-serve signs up chapter A, mints a state, and sends the
   * authorize URL to an admin of somebody else's Discord server. Discord's own
   * checks all pass — that person really does hold Manage Server there — so
   * before this step the callback bound (chapter A, victim's guild) and the
   * attacker could read the whole server.
   */
  it('REFUSES a token presented by a session scoped to another chapter', async () => {
    const service = await build();
    // The repository's chapter predicate is what decides. A pending row naming
    // chapter A does not match a confirm scoped to chapter B, so it updates
    // zero rows and returns null.
    repo.consumeConfirmToken.mockResolvedValue(null);

    await expect(
      service.confirmConnection(OTHER_CHAPTER, USER, STATE),
    ).rejects.toMatchObject({ status: 400 });

    expect(repo.consumeConfirmToken).toHaveBeenCalledWith(
      STATE,
      OTHER_CHAPTER,
      expect.any(Date),
    );
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('binds the parked guild ONLY to the chapter this request is scoped to', async () => {
    const service = await build();

    const view = await service.confirmConnection(CHAPTER, USER, STATE);

    expect(repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ chapter_id: CHAPTER, guild_id: GUILD }),
    );
    expect(view.connected).toBe(true);
  });

  it('scopes the spend by chapter in the same statement, not after reading', async () => {
    // A read-then-check would leave the window where two confirms both see the
    // token unspent. The chapter has to be part of the UPDATE, which is what
    // the repository asserts — here we pin that the service passes it at all.
    const service = await build();
    await service.confirmConnection(CHAPTER, USER, STATE);
    expect(repo.consumeConfirmToken).toHaveBeenCalledWith(
      STATE,
      CHAPTER,
      expect.any(Date),
    );
  });

  it('attributes the connection to whoever CONFIRMED, not whoever started it', async () => {
    // `created_by` on the state is whoever minted it. This step exists because
    // those need not be the same person, so recording the initiator would name
    // the attacker in the audit trail of a connection they did not complete.
    const service = await build();
    await service.confirmConnection(CHAPTER, 'confirming-user', STATE);
    expect(repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ connected_by: 'confirming-user' }),
    );
  });

  it('refuses a malformed token without asking the database', async () => {
    const service = await build();
    await expect(
      service.confirmConnection(CHAPTER, USER, "' or 1=1--"),
    ).rejects.toMatchObject({ status: 400 });
    expect(repo.consumeConfirmToken).not.toHaveBeenCalled();
  });

  it('refuses a row that carries no parked guild', async () => {
    const service = await build();
    repo.consumeConfirmToken.mockResolvedValue(stateRow());
    await expect(
      service.confirmConnection(CHAPTER, USER, STATE),
    ).rejects.toMatchObject({ status: 400 });
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('gives one message for every refusal, so it cannot be probed', async () => {
    // Wrong chapter, expired, already spent, never parked — all the same
    // sentence. "Wrong chapter" is precisely what an attacker holding a stolen
    // token would want confirmed.
    const service = await build();

    repo.consumeConfirmToken.mockResolvedValue(null);
    const wrongChapter = await service
      .confirmConnection(OTHER_CHAPTER, USER, STATE)
      .catch((error: Error) => error.message);

    repo.consumeConfirmToken.mockResolvedValue(stateRow());
    const notParked = await service
      .confirmConnection(CHAPTER, USER, STATE)
      .catch((error: Error) => error.message);

    expect(wrongChapter).toBe(notParked);
  });
});

describe('DiscordOAuthService — the redirect back', () => {
  it('sends the browser to the configured app origin, never elsewhere', async () => {
    const service = await build();
    // Even a stored path that somehow got past validation is resolved against
    // APP_URL, so it cannot leave the origin.
    repo.consumeState.mockResolvedValue(
      stateRow({ return_path: 'https://evil.example.com/phish' }),
    );

    const outcome = await service.handleCallback({ code: 'c', state: STATE });

    expect(new URL(outcome.returnUrl).origin).toBe('https://app.example.test');
  });

  it('carries only an enumerated code, never supplied error text', async () => {
    const service = await build();
    const outcome = await service.handleCallback({
      state: STATE,
      error: 'server_error',
      error_description: '<script>alert(1)</script> contact evil.example.com',
    });

    const url = new URL(outcome.returnUrl);
    expect(url.searchParams.get('discord')).toBe('failed');
    // Nothing an outside party wrote reaches the dashboard's own chrome.
    expect(outcome.returnUrl).not.toContain('evil.example.com');
    expect(outcome.returnUrl).not.toContain('script');
  });
});

describe('DiscordOAuthService — requireGuildId is the only way in', () => {
  it('resolves the guild through the chapter, and refuses without a connection', async () => {
    const service = await build();
    await expect(service.requireGuildId(CHAPTER)).rejects.toMatchObject({
      status: 400,
    });

    repo.findByChapter.mockResolvedValue({ guild_id: GUILD });
    await expect(service.requireGuildId(CHAPTER)).resolves.toBe(GUILD);
    expect(repo.findByChapter).toHaveBeenCalledWith(CHAPTER);
  });
});

describe('safeReturnPath', () => {
  it('keeps an ordinary site-relative path', () => {
    expect(safeReturnPath('/discord-import?tab=bot')).toBe(
      '/discord-import?tab=bot',
    );
  });

  it('rejects every shape that leaves the origin', () => {
    for (const hostile of [
      'https://evil.example.com',
      '//evil.example.com',
      // Browsers read a backslash as a separator on special-scheme URLs.
      '/\\evil.example.com',
      'javascript:alert(1)',
      'discord-import',
      '',
    ]) {
      expect(safeReturnPath(hostile)).toBe(DEFAULT_RETURN_PATH);
    }
  });

  it('rejects control characters the URL parser would delete mid-parse', () => {
    // `/\t/evil.com` is not the string that was checked by the time the
    // browser resolves it — the parser strips tab, LF and CR first.
    for (const hostile of [
      '/\t/evil.example.com',
      '/\n//evil.example.com',
      '/\r\n/x',
    ]) {
      expect(safeReturnPath(hostile)).toBe(DEFAULT_RETURN_PATH);
    }
  });

  it('falls back for null and undefined', () => {
    expect(safeReturnPath(null)).toBe(DEFAULT_RETURN_PATH);
    expect(safeReturnPath(undefined)).toBe(DEFAULT_RETURN_PATH);
  });
});
