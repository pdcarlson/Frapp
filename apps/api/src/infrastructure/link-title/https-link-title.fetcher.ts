import { Logger } from '@nestjs/common';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import type { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import type { LookupFunction } from 'node:net';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import type { Readable } from 'node:stream';
import type { ILinkTitleFetcher } from '#domain/adapters/link-title.interface';
import { fetchableUrl, isPublicAddress } from './link-title-guards';
import { headIsComplete, pageTitleFromHtml } from './page-title';

/** The whole read, redirects included, ends here. */
export const LINK_TITLE_TIMEOUT_MS = 5_000;
/** At most this much of a page is read; a title sits in the first few KB. */
export const LINK_TITLE_MAX_BYTES = 512 * 1024;
/** `forms.gle` → `docs.google.com` is one; more than three is a loop. */
export const LINK_TITLE_MAX_REDIRECTS = 3;

const USER_AGENT =
  'Mozilla/5.0 (compatible; FrappLinkTitle/1.0; +https://frapp.live)';

/** Resolves a host to every address it has, as `dns.lookup(host, { all: true })`. */
export type ResolveAll = (hostname: string) => Promise<LookupAddress[]>;

/** `https.request`'s shape, so a spec can answer without a network. */
export type HttpsRequest = (
  url: URL,
  options: RequestOptions,
  onResponse: (response: IncomingMessage) => void,
) => EventEmitter & {
  end(): unknown;
  destroy(error?: Error): unknown;
};

export interface LinkTitleFetchDeps {
  resolveAll: ResolveAll;
  request: HttpsRequest;
}

const systemResolveAll: ResolveAll = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) =>
      error ? reject(error) : resolve(addresses),
    );
  });

const systemRequest: HttpsRequest = (url, options, onResponse) =>
  httpsRequest(url, options, onResponse);

/** Thrown inside the read; any of them ends it with no title. */
class Refused extends Error {}

/**
 * The socket's own DNS lookup, refusing the connection when any address the
 * host resolves to is not public (`isPublicAddress`). It runs in the
 * connection itself, so the address checked is the address connected to:
 * there is no gap between a check and a second lookup for a rebinding DNS
 * server to answer differently in. Refusing on any bad address, not just
 * skipping it, keeps a host that mixes a public and a private answer out.
 */
export function guardedLookup(resolveAll: ResolveAll): LookupFunction {
  return (hostname, options, callback) => {
    resolveAll(hostname).then(
      (addresses) => {
        const usable = addresses.filter(
          (entry) =>
            (options.family === undefined ||
              options.family === 0 ||
              options.family === entry.family) &&
            isPublicAddress(entry.address),
        );
        if (
          usable.length === 0 ||
          addresses.some((entry) => !isPublicAddress(entry.address))
        ) {
          callback(new Refused('address refused'), '', 0);
          return;
        }
        if (options.all) {
          callback(null, usable);
        } else {
          callback(null, usable[0].address, usable[0].family);
        }
      },
      (error: unknown) =>
        callback(
          error instanceof Error ? error : new Refused('lookup failed'),
          '',
          0,
        ),
    );
  };
}

/** The body as text, decompressed, stopping at the head's end or the cap. */
function readHead(response: IncomingMessage): Promise<string> {
  const encoding = String(response.headers['content-encoding'] ?? '')
    .trim()
    .toLowerCase();
  let body: Readable = response;
  if (encoding === 'gzip' || encoding === 'x-gzip') {
    body = response.pipe(createGunzip());
  } else if (encoding === 'deflate') {
    body = response.pipe(createInflate());
  } else if (encoding === 'br') {
    body = response.pipe(createBrotliDecompress());
  } else if (encoding !== '' && encoding !== 'identity') {
    response.resume();
    return Promise.reject(new Refused('unknown encoding'));
  }

  return new Promise((resolve, reject) => {
    const decoder = new TextDecoder('utf-8');
    let text = '';
    let bytes = 0;
    let settled = false;
    const finish = (result: string | Error) => {
      if (settled) return;
      settled = true;
      // Stop the download; the rest of the page is not needed.
      response.destroy();
      if (body !== response) body.destroy();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    body.on('data', (chunk: Buffer) => {
      // Counted after decompression, so a small gzip can't unpack past it.
      const room = LINK_TITLE_MAX_BYTES - bytes;
      const slice = chunk.length > room ? chunk.subarray(0, room) : chunk;
      bytes += slice.length;
      text += decoder.decode(slice, { stream: true });
      if (headIsComplete(text) || bytes >= LINK_TITLE_MAX_BYTES) finish(text);
    });
    body.on('end', () => finish(text + decoder.decode()));
    body.on('error', (error: Error) => finish(error));
    // Closed before its end: aborted by the deadline or the server.
    body.on('close', () => finish(new Refused('closed early')));
    response.on('error', (error: Error) => finish(error));
  });
}

/**
 * The guarded fetch behind link titles (#4187; the guards are listed on
 * `ILinkTitleFetcher` and in `spec/behavior/activity.md` § Links).
 *
 * Each hop is checked before it is requested: the URL against the sign-up
 * list (`fetchableUrl`), then every address its host resolves to
 * (`guardedLookup`), inside the connection. Redirects are never followed by
 * the HTTP client; each `Location` goes through the same checks, at most
 * three times, so Google's redirect to its sign-in page for a private file
 * (off the list) ends the read with no title. A `GET` with no cookies or
 * credentials, `https` only, one deadline over the whole chain, and a cap on
 * the bytes read. Only a `200` HTML page is read.
 *
 * Not `@Injectable`: the module builds it with a factory, and a spec passes
 * its own DNS and request in place of the network.
 */
export class HttpsLinkTitleFetcher implements ILinkTitleFetcher {
  private readonly logger = new Logger(HttpsLinkTitleFetcher.name);
  private readonly deps: LinkTitleFetchDeps;

  constructor(deps?: Partial<LinkTitleFetchDeps>) {
    this.deps = {
      resolveAll: deps?.resolveAll ?? systemResolveAll,
      request: deps?.request ?? systemRequest,
    };
  }

  async fetchTitle(url: string): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Refused('timed out')),
      LINK_TITLE_TIMEOUT_MS,
    );
    const deadline = controller.signal;
    try {
      let target = fetchableUrl(url);
      for (let hop = 0; target && hop <= LINK_TITLE_MAX_REDIRECTS; hop += 1) {
        const response = await this.get(target, deadline);
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          const location = response.headers.location;
          response.resume();
          target = location ? fetchableUrl(location, target) : null;
          continue;
        }
        const type = String(response.headers['content-type'] ?? '');
        if (status !== 200 || !/^\s*text\/html\b/i.test(type)) {
          response.resume();
          return null;
        }
        return pageTitleFromHtml(await readHead(response));
      }
      return null;
    } catch (error) {
      // Expected for refused hosts, timeouts and unreachable pages: the row
      // keeps its kind, which is the designed outcome, so nothing is lost.
      this.logger.debug(
        `link title not read: ${error instanceof Error ? error.name : 'error'}`,
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private get(target: URL, signal: AbortSignal): Promise<IncomingMessage> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Refused('timed out'));
        return;
      }
      const req = this.deps.request(
        target,
        {
          method: 'GET',
          signal,
          timeout: LINK_TITLE_TIMEOUT_MS,
          lookup: guardedLookup(this.deps.resolveAll),
          // A fresh connection each time: a pooled socket was checked for
          // another hop's host, not this one.
          agent: false,
          headers: {
            'user-agent': USER_AGENT,
            accept: 'text/html,application/xhtml+xml;q=0.9',
            'accept-language': 'en-US,en;q=0.8',
            'accept-encoding': 'gzip, deflate, br',
          },
        },
        resolve,
      );
      req.on('error', reject);
      // The socket's idle timeout; the deadline above bounds the whole chain.
      req.on('timeout', () => req.destroy(new Refused('timed out')));
      req.end();
    });
  }
}
