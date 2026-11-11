import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { LookupAddress } from 'node:dns';
import type { RequestOptions } from 'node:https';
import { PassThrough } from 'node:stream';
import { gzipSync } from 'node:zlib';
import {
  HttpsLinkTitleFetcher,
  LINK_TITLE_MAX_BYTES,
  charsetOf,
  guardedLookup,
  readHead,
  type HttpsRequest,
} from './https-link-title.fetcher';

interface Reply {
  status: number;
  headers?: Record<string, string>;
  body?: string | Buffer;
  /** Never answer, so only the deadline ends the read. */
  hang?: boolean;
}

const PUBLIC: LookupAddress[] = [{ address: '142.250.80.46', family: 4 }];

/**
 * A stand-in for `https.request` that does what the real one does with the
 * options it is given: runs the `lookup` the fetcher passed (so the address
 * guard is exercised, not mocked), and only then answers from `replies`.
 */
function fakeNetwork(
  replies: Record<string, Reply>,
  dns: Record<string, LookupAddress[]> = {},
) {
  const requested: string[] = [];
  const optionsSeen: RequestOptions[] = [];
  const responses: PassThrough[] = [];
  const resolveAll = jest.fn(async (hostname: string) => {
    const answer = dns[hostname] ?? PUBLIC;
    if (answer.length === 0) {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND'), {
        code: 'ENOTFOUND',
      });
    }
    return answer;
  });
  const request: HttpsRequest = (url, options, onResponse) => {
    const req = new EventEmitter() as EventEmitter & {
      end(): void;
      destroy(error?: Error): void;
    };
    req.destroy = (error?: Error) => {
      if (error) req.emit('error', error);
    };
    req.end = () => {
      requested.push(url.href);
      optionsSeen.push(options);
      const lookup = options.lookup!;
      lookup(url.hostname, { all: true }, (error) => {
        if (error) {
          req.emit('error', error);
          return;
        }
        const reply = replies[url.href];
        if (!reply) {
          req.emit('error', new Error(`no reply for ${url.href}`));
          return;
        }
        if (reply.hang) {
          options.signal?.addEventListener('abort', () =>
            req.emit('error', new Error('aborted')),
          );
          return;
        }
        const response = new PassThrough() as unknown as IncomingMessage &
          PassThrough;
        response.statusCode = reply.status;
        response.headers = reply.headers ?? {};
        responses.push(response);
        onResponse(response);
        response.end(reply.body ?? '');
      });
    };
    return req;
  };
  return { requested, optionsSeen, responses, resolveAll, request };
}

const html = (title: string) =>
  `<html><head><title>${title}</title></head><body>…</body></html>`;
const HTML = { 'content-type': 'text/html; charset=utf-8' };
const NONE = { outcome: 'none' };
const named = (title: string) => ({ outcome: 'title', title });

describe('HttpsLinkTitleFetcher (#4187)', () => {
  it('reads a public form’s title', async () => {
    const net = fakeNetwork({
      'https://docs.google.com/forms/d/e/abc/viewform': {
        status: 200,
        headers: HTML,
        body: '<head><meta property="og:title" content="5K volunteer shifts"><title>Google Forms</title></head>',
      },
    });
    const fetcher = new HttpsLinkTitleFetcher(net);

    await expect(
      fetcher.fetchTitle('https://docs.google.com/forms/d/e/abc/viewform'),
    ).resolves.toEqual(named('5K volunteer shifts'));
    // No pooled socket, no credentials, and a GET.
    expect(net.optionsSeen[0]).toMatchObject({ method: 'GET', agent: false });
    expect(net.optionsSeen[0].headers).not.toHaveProperty('cookie');
    expect(net.optionsSeen[0].headers).not.toHaveProperty('authorization');
  });

  it('follows forms.gle to the form', async () => {
    const net = fakeNetwork({
      'https://forms.gle/abc': {
        status: 302,
        headers: {
          location: 'https://docs.google.com/forms/d/e/abc/viewform',
        },
      },
      'https://docs.google.com/forms/d/e/abc/viewform': {
        status: 200,
        headers: HTML,
        body: html('Formal RSVP'),
      },
    });

    await expect(
      new HttpsLinkTitleFetcher(net).fetchTitle('https://forms.gle/abc'),
    ).resolves.toEqual(named('Formal RSVP'));
    expect(net.requested).toEqual([
      'https://forms.gle/abc',
      'https://docs.google.com/forms/d/e/abc/viewform',
    ]);
  });

  it('stops at Google’s sign-in redirect for a private file, without opening it', async () => {
    const net = fakeNetwork({
      'https://docs.google.com/spreadsheets/d/abc/edit': {
        status: 302,
        headers: {
          location:
            'https://accounts.google.com/ServiceLogin?continue=https://docs.google.com/spreadsheets/d/abc/edit',
        },
      },
    });

    await expect(
      new HttpsLinkTitleFetcher(net).fetchTitle(
        'https://docs.google.com/spreadsheets/d/abc/edit',
      ),
    ).resolves.toEqual(NONE);
    expect(net.requested).toEqual([
      'https://docs.google.com/spreadsheets/d/abc/edit',
    ]);
  });

  it('gives a sign-in page served in place no title', async () => {
    const net = fakeNetwork({
      'https://forms.office.com/r/abc': {
        status: 200,
        headers: HTML,
        body: html('Sign in to your account'),
      },
    });

    await expect(
      new HttpsLinkTitleFetcher(net).fetchTitle(
        'https://forms.office.com/r/abc',
      ),
    ).resolves.toEqual(NONE);
  });

  it('never opens a URL off the sign-up list, or with credentials or a port', async () => {
    const net = fakeNetwork({});
    const fetcher = new HttpsLinkTitleFetcher(net);

    for (const url of [
      'https://example.com/forms/d/abc',
      'https://calendly.com:1@evil.example/',
      'https://calendly.com:8443/olive',
      'https://169.254.169.254/latest/meta-data/',
    ]) {
      await expect(fetcher.fetchTitle(url)).resolves.toEqual(NONE);
    }
    expect(net.requested).toEqual([]);
    expect(net.resolveAll).not.toHaveBeenCalled();
  });

  it('refuses a sign-up host whose DNS answers a private address', async () => {
    const net = fakeNetwork(
      {
        'https://calendly.com/olive': {
          status: 200,
          headers: HTML,
          body: html('Never read'),
        },
      },
      { 'calendly.com': [{ address: '169.254.169.254', family: 4 }] },
    );

    await expect(
      new HttpsLinkTitleFetcher(net).fetchTitle('https://calendly.com/olive'),
    ).resolves.toEqual(NONE);
  });

  it('refuses a host that mixes a public and a private answer', async () => {
    const net = fakeNetwork(
      {
        'https://calendly.com/olive': {
          status: 200,
          headers: HTML,
          body: html('Never read'),
        },
      },
      {
        'calendly.com': [
          { address: '104.18.12.1', family: 4 },
          { address: '::1', family: 6 },
        ],
      },
    );

    await expect(
      new HttpsLinkTitleFetcher(net).fetchTitle('https://calendly.com/olive'),
    ).resolves.toEqual(NONE);
  });

  it('stops after three redirects', async () => {
    const hop = (n: number) => `https://calendly.com/hop${n}`;
    const replies: Record<string, Reply> = {};
    for (let n = 0; n < 5; n += 1) {
      replies[hop(n)] = { status: 301, headers: { location: hop(n + 1) } };
    }
    const net = fakeNetwork(replies);

    await expect(
      new HttpsLinkTitleFetcher(net).fetchTitle(hop(0)),
    ).resolves.toEqual(NONE);
    expect(net.requested).toHaveLength(4);
  });

  it('reads only a 200 HTML page', async () => {
    const net = fakeNetwork({
      'https://calendly.com/missing': {
        status: 404,
        headers: HTML,
        body: html('Olive Ramos'),
      },
      'https://calendly.com/json': {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"title":"x"}',
      },
    });
    const fetcher = new HttpsLinkTitleFetcher(net);

    await expect(
      fetcher.fetchTitle('https://calendly.com/missing'),
    ).resolves.toEqual(NONE);
    await expect(
      fetcher.fetchTitle('https://calendly.com/json'),
    ).resolves.toEqual(NONE);
  });

  it('never parses a 200 that is not HTML, even one carrying a <title>', async () => {
    const net = fakeNetwork({
      'https://calendly.com/plain': {
        status: 200,
        headers: { 'content-type': 'text/plain' },
        body: html('Not a page'),
      },
    });

    await expect(
      new HttpsLinkTitleFetcher(net).fetchTitle('https://calendly.com/plain'),
    ).resolves.toEqual(NONE);
    expect(net.responses[0].destroyed).toBe(true);
  });

  it('destroys a response it does not read, rather than draining it', async () => {
    const net = fakeNetwork({
      'https://calendly.com/missing': {
        status: 404,
        headers: HTML,
        body: html('Olive Ramos'),
      },
      'https://forms.gle/abc': {
        status: 302,
        headers: { location: 'https://accounts.google.com/ServiceLogin' },
        body: 'x'.repeat(1024),
      },
    });
    const fetcher = new HttpsLinkTitleFetcher(net);

    await fetcher.fetchTitle('https://calendly.com/missing');
    await fetcher.fetchTitle('https://forms.gle/abc');
    expect(net.responses.map((response) => response.destroyed)).toEqual([
      true,
      true,
    ]);
  });

  it.each([
    [503, 'server-error'],
    [500, 'server-error'],
    [429, 'server-error'],
  ])('calls a %i a failed read, to be tried again', async (status, reason) => {
    const net = fakeNetwork({
      'https://calendly.com/busy': { status, headers: HTML, body: '' },
    });

    await expect(
      new HttpsLinkTitleFetcher(net).fetchTitle('https://calendly.com/busy'),
    ).resolves.toEqual({ outcome: 'failed', reason });
  });

  it('calls a host that does not resolve a failed read, not a page with no name', async () => {
    const net = fakeNetwork({}, { 'calendly.com': [] });

    await expect(
      new HttpsLinkTitleFetcher(net).fetchTitle('https://calendly.com/olive'),
    ).resolves.toEqual({ outcome: 'failed', reason: 'network' });
  });

  it('decodes a page in the charset it names', async () => {
    const net = fakeNetwork({
      'https://calendly.com/olive': {
        status: 200,
        headers: { 'content-type': 'text/html; charset=windows-1252' },
        body: Buffer.concat([
          Buffer.from('<head><title>Caf'),
          Buffer.from([0xe9]),
          Buffer.from(' night</title></head>'),
        ]),
      },
    });

    await expect(
      new HttpsLinkTitleFetcher(net).fetchTitle('https://calendly.com/olive'),
    ).resolves.toEqual(named('Café night'));
  });

  it('reads a gzip page, and stops at the size cap however far it unpacks', async () => {
    const big = `<html><head>${' '.repeat(LINK_TITLE_MAX_BYTES * 2)}<title>Too far</title></head>`;
    const net = fakeNetwork({
      'https://calendly.com/small': {
        status: 200,
        headers: { ...HTML, 'content-encoding': 'gzip' },
        body: gzipSync(html('Olive Ramos')),
      },
      'https://calendly.com/bomb': {
        status: 200,
        headers: { ...HTML, 'content-encoding': 'gzip' },
        body: gzipSync(big),
      },
    });
    const fetcher = new HttpsLinkTitleFetcher(net);

    await expect(
      fetcher.fetchTitle('https://calendly.com/small'),
    ).resolves.toEqual(named('Olive Ramos'));
    // The title sits past the cap, so it is never reached.
    await expect(
      fetcher.fetchTitle('https://calendly.com/bomb'),
    ).resolves.toEqual(NONE);
  });

  it('gives up at the deadline', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      const net = fakeNetwork({
        'https://calendly.com/slow': { status: 200, hang: true },
      });
      const pending = new HttpsLinkTitleFetcher(net).fetchTitle(
        'https://calendly.com/slow',
      );
      await jest.advanceTimersByTimeAsync(5_001);
      await expect(pending).resolves.toEqual({
        outcome: 'failed',
        reason: 'timeout',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  describe('readHead', () => {
    const stream = () => {
      const response = new PassThrough() as unknown as IncomingMessage &
        PassThrough;
      response.headers = {};
      return response;
    };

    it('stops reading where the head ends, and stops the download', async () => {
      const response = stream();
      const pending = readHead(response);
      response.write('<html><head><title>Rush BBQ</title></head>');

      await expect(pending).resolves.toContain('Rush BBQ');
      expect(response.destroyed).toBe(true);
    });

    it('stops at the size cap, however much more is coming', async () => {
      const response = stream();
      const pending = readHead(response);
      const chunk = Buffer.alloc(64 * 1024, 0x20);
      for (let sent = 0; sent <= LINK_TITLE_MAX_BYTES; sent += chunk.length) {
        if (response.destroyed) break;
        response.write(chunk);
      }

      const text = await pending;
      expect(text).toHaveLength(LINK_TITLE_MAX_BYTES);
      expect(response.destroyed).toBe(true);
    });

    it('fails a body that breaks off after the headers, instead of hanging', async () => {
      const response = stream();
      const pending = readHead(response);
      response.write('<html><head><title>Half');
      response.destroy(new Error('aborted'));

      await expect(pending).rejects.toThrow('aborted');
    });

    it('fails a body that closes before its end', async () => {
      const response = stream();
      const pending = readHead(response);
      response.write('<html><head>');
      response.destroy();

      await expect(pending).rejects.toThrow('closed early');
    });
  });

  describe('charsetOf', () => {
    it('reads a charset the decoder knows, and falls back to UTF-8', () => {
      expect(charsetOf('text/html; charset=ISO-8859-1')).toBe('windows-1252');
      expect(charsetOf('text/html; charset="utf-8"')).toBe('utf-8');
      expect(charsetOf('text/html; charset=nonsense')).toBe('utf-8');
      expect(charsetOf('text/html')).toBe('utf-8');
    });
  });

  describe('guardedLookup', () => {
    it('answers with the vetted addresses, all or the first', async () => {
      const lookup = guardedLookup(async () => PUBLIC);
      const all = await new Promise((resolve) =>
        lookup('calendly.com', { all: true }, (error, addresses) =>
          resolve({ error, addresses }),
        ),
      );
      expect(all).toEqual({ error: null, addresses: PUBLIC });

      const one = await new Promise((resolve) =>
        lookup('calendly.com', {}, (error, address, family) =>
          resolve({ error, address, family }),
        ),
      );
      expect(one).toEqual({ error: null, address: '142.250.80.46', family: 4 });
    });

    it('fails a lookup that finds nothing public', async () => {
      const lookup = guardedLookup(async () => [
        { address: '10.0.0.5', family: 4 },
      ]);
      const error = await new Promise((resolve) =>
        lookup('calendly.com', { all: true }, (err) => resolve(err)),
      );
      expect(error).toBeInstanceOf(Error);
    });
  });
});
