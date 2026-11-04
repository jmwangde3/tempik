/**
 * Input validation shared by the API layer.
 *
 * The API used to accept any string as a local-part, so addresses like
 * `x@y@example.com`, `a b@example.com` or 300-character names were created and
 * stored forever. They can never receive mail, so they only pollute the table.
 *
 * RFC 5321 caps a local-part at 64 octets; the charset here is the practical
 * subset that Cloudflare Email Routing and every provider accept.
 */

const LOCAL_PART_RE = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

/** Session IDs are minted as UUIDv4; anything else is a client bug or an attack. */
const SESSION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidLocalPart(value: string): boolean {
  if (typeof value !== 'string') return false;
  if (value.length < 1 || value.length > 64) return false;
  if (!LOCAL_PART_RE.test(value)) return false;
  if (value.includes('..')) return false;
  return true;
}

export function normalizeLocalPart(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return isValidLocalPart(trimmed) ? trimmed : null;
}

export function isValidSessionId(value: string): boolean {
  return typeof value === 'string' && SESSION_ID_RE.test(value);
}

/**
 * Domains come from `MAIL_DOMAIN` (comma separated). Compare case-insensitively
 * and ignore surrounding whitespace, so `EXAMPLE.COM ` matches `example.com`.
 */
export function normalizeDomain(value: unknown, allowed: string[]): string | null {
  if (typeof value !== 'string') return null;
  const domain = value.trim().toLowerCase();
  if (!domain) return null;
  return allowed.includes(domain) ? domain : null;
}
