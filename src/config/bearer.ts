import { createHash, timingSafeEqual } from 'node:crypto';

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function readBearerToken(
  authorization: string | string[] | undefined,
): string | undefined {
  const header = Array.isArray(authorization)
    ? authorization[0]
    : authorization;
  if (typeof header !== 'string') return undefined;

  const match = /^Bearer (.+)$/i.exec(header);
  const token = match?.[1]?.trim();
  return token === '' ? undefined : token;
}

export function bearerTokenMatches(
  expected: string,
  received: string,
): boolean {
  return timingSafeEqual(sha256(expected), sha256(received));
}
