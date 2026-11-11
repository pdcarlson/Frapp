/**
 * Whether a base64 ThumbHash carries every byte a decoder reads.
 *
 * A ThumbHash (<https://evanw.github.io/thumbhash/>) is a 5-byte header (6
 * with alpha) and then 4-bit AC coefficients, as many as the header's sizes
 * imply. The decoders index those bytes without a length check: expo-image's
 * iOS decoder (`ios/Utils/Thumbhash.swift`, `thumbHashToRGBA`) traps on a
 * hash that is short, which kills the app, and a base64 pattern alone admits
 * one (`AAAA` is 3 bytes). So the API stores, and clients draw, only a hash
 * this accepts (#3879): one whose header's own sizes are all present.
 */
const BASE64 = /^[A-Za-z0-9+/]{4,48}={0,2}$/;
const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function decodeBase64(value: string): number[] | null {
  if (!BASE64.test(value)) return null;
  const body = value.replace(/=+$/, "");
  if (body.length % 4 === 1) return null;
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of body) {
    buffer = (buffer << 6) | ALPHABET.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return bytes;
}

/** How many AC coefficients a channel of `nx` by `ny` carries, as the decoder counts them. */
function acCount(nx: number, ny: number): number {
  let count = 0;
  for (let cy = 0; cy < ny; cy++) {
    for (let cx = cy > 0 ? 0 : 1; cx * ny < nx * (ny - cy); cx++) count++;
  }
  return count;
}

export function isDecodableThumbhash(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const hash = decodeBase64(value);
  if (!hash || hash.length < 5) return false;
  const header24 = hash[0]! | (hash[1]! << 8) | (hash[2]! << 16);
  const header16 = hash[3]! | (hash[4]! << 8);
  const hasAlpha = header24 >> 23 !== 0;
  const isLandscape = header16 >> 15 !== 0;
  const lx = Math.max(3, isLandscape ? (hasAlpha ? 5 : 7) : header16 & 7);
  const ly = Math.max(3, isLandscape ? header16 & 7 : hasAlpha ? 5 : 7);
  const acs =
    acCount(lx, ly) + 2 * acCount(3, 3) + (hasAlpha ? acCount(5, 5) : 0);
  const acStart = hasAlpha ? 6 : 5;
  return hash.length >= acStart + Math.ceil(acs / 2);
}
