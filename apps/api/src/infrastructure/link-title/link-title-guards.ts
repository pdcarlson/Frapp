import { BlockList, isIP } from 'node:net';
import { signUpLinkKind } from '@repo/validation';

/**
 * The SSRF guards on the link title fetch (#4187). Pure functions, so each
 * guard is tested on its own; `HttpsLinkTitleFetcher` applies them to every
 * hop, the first request and each redirect alike.
 */

/**
 * Whether a host and path is a sign-up page Activity gathers:
 * `signUpLinkKind` in `@repo/validation`, the TypeScript copy of
 * `activity_action_links` (`20261111030000_activity_links.sql`), which a
 * fixture set holds to agreement (#4215). The database list decides what is
 * indexed; this decides what may be opened, so a redirect is held to it too.
 */
export function isSignUpHost(host: string, path: string): boolean {
  return signUpLinkKind(host, path) !== null;
}

/**
 * The URL to request for a posted link or a redirect's `Location`, or null
 * when it may not be opened. Refused: anything but http(s); a user name or
 * password (`https://calendly.com:1@evil.example/` opens `evil.example`); a
 * port other than the scheme's own; an IP literal; and any host and path off
 * the sign-up list. An `http` link is upgraded to `https` on the same host,
 * so nothing is ever sent in the clear.
 */
export function fetchableUrl(raw: string, base?: URL): URL | null {
  let url: URL;
  try {
    url = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username !== '' || url.password !== '') return null;
  // `URL` drops a scheme's own port, so any port left is a different one.
  if (url.port !== '') return null;
  if (url.protocol === 'http:') {
    url.protocol = 'https:';
    if (url.port !== '') return null;
  }
  const hostname = url.hostname.toLowerCase();
  // An IPv6 literal keeps its brackets in `hostname`.
  if (isIP(hostname) !== 0 || hostname.startsWith('[')) return null;
  const host = hostname.replace(/^www\./, '');
  if (!isSignUpHost(host, url.pathname)) return null;
  url.hash = '';
  return url;
}

/**
 * Addresses the fetch never connects to: everything that is not the public
 * internet. IPv4: "this network", private, shared (CGNAT), loopback,
 * link-local (cloud metadata lives at 169.254.169.254), IETF protocol
 * assignments, documentation, 6to4 relay, benchmarking, multicast, reserved
 * and broadcast. IPv6 is refused unless it is global unicast (`2000::/3`),
 * which rules out loopback, unspecified, IPv4-mapped and -compatible forms,
 * NAT64, unique-local, link-local and multicast in one rule; within
 * `2000::/3`, Teredo, documentation, ORCHID and 6to4 are refused too, since
 * each can carry or stand in for an address refused above.
 */
const REFUSED = (() => {
  const list = new BlockList();
  const v4: [string, number][] = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ];
  for (const [net, prefix] of v4) list.addSubnet(net, prefix, 'ipv4');
  const v6: [string, number][] = [
    ['2001::', 32],
    ['2001:2::', 48],
    ['2001:10::', 28],
    ['2001:20::', 28],
    ['2001:db8::', 32],
    ['2002::', 16],
  ];
  for (const [net, prefix] of v6) list.addSubnet(net, prefix, 'ipv6');
  return list;
})();

const GLOBAL_UNICAST_V6 = (() => {
  const list = new BlockList();
  list.addSubnet('2000::', 3, 'ipv6');
  return list;
})();

/** Whether the fetch may connect to this resolved address. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !REFUSED.check(address, 'ipv4');
  if (family === 6) {
    return (
      GLOBAL_UNICAST_V6.check(address, 'ipv6') &&
      !REFUSED.check(address, 'ipv6')
    );
  }
  return false;
}
