import { gunzipSync } from 'node:zlib';

/**
 * Decode a PostHog SDK body. Production gzip-compresses `/batch/`; tests
 * disable compression so the JSON is inspectable, but the decoder still
 * handles gzip so a PII assertion cannot be skipped by encoding.
 */
export async function decodePosthogBody(
  body: string | Blob | undefined,
  contentEncoding?: string | null,
): Promise<string> {
  if (body === undefined) return '';
  const encoding = contentEncoding?.toLowerCase() ?? '';
  if (typeof body === 'string') {
    if (encoding.includes('gzip')) {
      return gunzipSync(Buffer.from(body, 'binary')).toString('utf8');
    }
    return body;
  }
  const buf = Buffer.from(await body.arrayBuffer());
  if (encoding.includes('gzip')) {
    return gunzipSync(buf).toString('utf8');
  }
  return buf.toString('utf8');
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;

/**
 * Assert a decoded PostHog envelope (events or logs) carries no PII, content,
 * or exception payload. Used by the fake transport in tests; production does
 * not call this on the hot path.
 *
 * OTLP log records use a `body` field for the log name (`request`,
 * `security_event`) — that is not user content and is not a finding.
 */
export function assertPosthogEnvelopeSafe(
  decoded: string,
  fixtures: string[] = [],
): void {
  for (const fixture of fixtures) {
    if (fixture && decoded.includes(fixture)) {
      throw new Error(
        `PostHog envelope leaked fixture ${JSON.stringify(fixture)}`,
      );
    }
  }
  if (EMAIL_RE.test(decoded)) {
    throw new Error('PostHog envelope leaked an email');
  }
  if (IPV4_RE.test(decoded)) {
    throw new Error('PostHog envelope leaked an IPv4 address');
  }
  if (
    decoded.includes('"$exception"') ||
    decoded.includes('$exception_list') ||
    decoded.includes('"stacktrace"')
  ) {
    throw new Error('PostHog envelope carried an exception payload');
  }
}
