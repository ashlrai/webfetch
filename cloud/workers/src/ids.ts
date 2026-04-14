/**
 * Small id utilities.
 *
 * We use a ulid-ish 26-char Crockford-base32 id everywhere. Not a perfect
 * ulid (no monotonic sorting guarantee inside the same ms), but it's
 * lexicographically time-ordered, URL-safe, and collision-free in practice
 * for our write volume.
 */

const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** ulid-ish 26-char id, time-sortable. */
export function ulid(now = Date.now()): string {
  const timePart = encodeTime(now, 10);
  const randPart = encodeRandom(16);
  return timePart + randPart;
}

function encodeTime(ms: number, len: number): string {
  let out = "";
  let n = ms;
  for (let i = len - 1; i >= 0; i--) {
    out = B32[n % 32] + out;
    n = Math.floor(n / 32);
  }
  return out;
}

function encodeRandom(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += B32[bytes[i]! % 32];
  return out;
}

/** Short opaque request id embedded in `x-request-id` response header. */
export function requestId(): string {
  return ulid();
}

/** SHA-256 hex digest of a string. */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string compare to thwart timing attacks on key lookup. */
export function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
