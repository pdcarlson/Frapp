import {
  decodePosthogBody,
  assertPosthogEnvelopeSafe,
} from './posthog-envelope';

/**
 * Shape `posthog-node` expects from a custom `fetch`. Not the Fetch `Response`
 * object — the SDK reads `.status` / `.text()` / `.json()` only.
 */
export type PosthogFetchResponse = {
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
  headers?: { get(name: string): string | null };
};

export type PosthogFetchOptions = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  headers: { [key: string]: string };
  body?: string | Blob;
  signal?: AbortSignal;
};

export type PosthogFetch = (
  url: string,
  options: PosthogFetchOptions,
) => Promise<PosthogFetchResponse>;

export interface RecordedPosthogCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  decodedBody: string;
  parsed: unknown;
}

export type RecordingTransportMode =
  | { type: 'ok' }
  | { type: 'http'; status: number; times?: number }
  | { type: 'network'; times?: number };

function jsonResponse(status: number, body: unknown): PosthogFetchResponse {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const parsed: unknown =
    typeof body === 'string' ? (JSON.parse(body) as unknown) : body;
  return {
    status,
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(parsed),
    headers: { get: () => null },
  };
}

function defaultOkBody(url: string): unknown {
  if (
    url.includes('/batch') ||
    url.includes('/capture') ||
    url.includes('/e/')
  ) {
    return { status: 1 };
  }
  if (url.includes('/flags') || url.includes('/decide')) {
    return { featureFlags: {}, featureFlagPayloads: {} };
  }
  return {};
}

/**
 * In-memory PostHog transport for tests. Records every envelope after gzip
 * decode and runs {@link assertPosthogEnvelopeSafe} so a leak fails the
 * suite at the wire, not in a later assertion that might be skipped.
 */
export class RecordingPosthogTransport {
  readonly calls: RecordedPosthogCall[] = [];
  mode: RecordingTransportMode = { type: 'ok' };
  flagValues: Record<string, boolean | string> = {};
  private remainingFails = 0;

  constructor(private readonly fixtures: string[] = []) {}

  setMode(mode: RecordingTransportMode): void {
    this.mode = mode;
    if (mode.type === 'http' || mode.type === 'network') {
      this.remainingFails = mode.times ?? Number.POSITIVE_INFINITY;
    } else {
      this.remainingFails = 0;
    }
  }

  readonly fetch: PosthogFetch = async (url, options) => {
    const encoding =
      options.headers['Content-Encoding'] ??
      options.headers['content-encoding'] ??
      null;
    const decodedBody = await decodePosthogBody(options.body, encoding);
    if (decodedBody.length > 0) {
      assertPosthogEnvelopeSafe(decodedBody, this.fixtures);
    }
    let parsed: unknown = decodedBody;
    try {
      parsed = decodedBody ? JSON.parse(decodedBody) : {};
    } catch {
      parsed = decodedBody;
    }
    this.calls.push({
      url,
      method: options.method,
      headers: options.headers,
      decodedBody,
      parsed,
    });

    if (
      (this.mode.type === 'http' || this.mode.type === 'network') &&
      this.remainingFails > 0
    ) {
      this.remainingFails -= 1;
      if (this.mode.type === 'network') {
        throw new Error('posthog-test-network-error');
      }
      return jsonResponse(this.mode.status, { status: 0 });
    }

    if (url.includes('/flags') || url.includes('/decide')) {
      return jsonResponse(200, {
        featureFlags: this.flagValues,
        featureFlagPayloads: {},
      });
    }

    return jsonResponse(200, defaultOkBody(url));
  };
}
