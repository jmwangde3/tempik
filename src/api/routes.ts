import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import {
  getInbox,
  createInbox,
  inboxExists,
  getSessionInboxes,
  getMessages,
  ensureSession,
  linkInboxToSession,
  unlinkInboxFromSession,
  isInboxInSession,
  countSessionInboxes,
  countOtherSessionsForInbox,
} from '../db/queries';
import { generateUniqueAddress } from '../utils/random-address';
import { isValidSessionId, normalizeDomain, normalizeLocalPart } from '../utils/validate';
import { toIsoUtc } from '../utils/time';

export interface ApiEnv {
  DB: D1Database;
  APP_NAME: string;
  MAIL_DOMAIN: string;
  WEB_HOST: string;
  MAX_INBOXES_PER_SESSION?: string;
}

const DEFAULT_MAX_INBOXES = 50;
const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 200;

function getDomains(env: ApiEnv): string[] {
  return env.MAIL_DOMAIN.split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
}

function defaultDomain(env: ApiEnv): string {
  return getDomains(env)[0] || 'example.com';
}

function maxInboxes(env: ApiEnv): number {
  const parsed = Number.parseInt(env.MAX_INBOXES_PER_SESSION ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_INBOXES;
}

type SessionResult = { ok: true; sid: string } | { ok: false; error: string };

/**
 * A session ID is the only credential in this API, so it is shape-checked
 * instead of trusted as an opaque string. The old version accepted anything
 * non-empty, which let a 300-character blob reach the database.
 */
function requireSession(c: any): SessionResult {
  const raw = (c.req.header('x-session-id') || '').trim();
  if (!raw) return { ok: false, error: 'Missing x-session-id' };
  if (!isValidSessionId(raw)) return { ok: false, error: 'Malformed x-session-id (expected UUID)' };
  return { ok: true, sid: raw.toLowerCase() };
}

function parseAddressParam(c: any): string {
  // Hono already runs decodeURIComponent on path params; decoding twice turned
  // a literal "%40" in the address into "@".
  return String(c.req.param('address') || '').trim();
}

const api = new Hono<{ Bindings: ApiEnv }>();

// Private, per-session data: never let an intermediary or the browser reuse it.
api.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
});

// ---- GET /api/config ----
api.get('/config', (c) => {
  const domains = getDomains(c.env);
  return c.json({
    appName: c.env.APP_NAME || 'Tempik',
    mailDomain: domains[0] || 'example.com',
    mailDomains: domains,
    webHost: c.env.WEB_HOST || 'tempik.example.com',
    maxInboxesPerSession: maxInboxes(c.env),
    messageLimit: DEFAULT_MESSAGE_LIMIT,
  });
});

// ---- GET /api/session ----
api.get('/session', async (c) => {
  const raw = (c.req.header('x-session-id') || '').trim();

  if (raw && !isValidSessionId(raw)) {
    return c.json({ error: 'Malformed x-session-id (expected UUID)' }, 400);
  }

  const sid = raw ? raw.toLowerCase() : crypto.randomUUID();
  await ensureSession(c.env.DB, sid);
  return c.json({ sessionId: sid });
});

// ---- GET /api/inboxes ----
api.get('/inboxes', async (c) => {
  const s = requireSession(c);
  if (!s.ok) return c.json({ error: s.error }, 400);

  const inboxes = await getSessionInboxes(c.env.DB, s.sid);
  return c.json(inboxes.map(i => ({ ...i, created_at: toIsoUtc(i.created_at) })));
});

// ---- POST /api/inboxes ----
api.post('/inboxes', async (c) => {
  const s = requireSession(c);
  if (!s.ok) return c.json({ error: s.error }, 400);

  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);

  const domains = getDomains(c.env);
  const rawDomain = (body as any).domain;
  let domain = defaultDomain(c.env);
  if (rawDomain !== undefined && rawDomain !== null && String(rawDomain).trim() !== '') {
    const normalized = normalizeDomain(rawDomain, domains);
    if (!normalized) {
      return c.json(
        { error: `Invalid domain: ${String(rawDomain).slice(0, 80)}. Allowed: ${domains.join(', ')}` },
        400
      );
    }
    domain = normalized;
  }

  const rawLocal = (body as any).localPart;
  let localPart: string | null = null;
  if (rawLocal !== undefined && rawLocal !== null && String(rawLocal).trim() !== '') {
    localPart = normalizeLocalPart(rawLocal);
    if (!localPart) {
      return c.json(
        {
          error:
            'Invalid localPart: use 1-64 characters from a-z, 0-9, dot, dash or underscore, ' +
            'starting and ending with a letter or digit',
        },
        400
      );
    }
  }

  // FK to sessions(id) is enforced by D1, so a client that sends its own UUID
  // without calling GET /api/session first used to get a 500 from
  // session_inboxes. Create the row instead of exploding.
  await ensureSession(c.env.DB, s.sid);

  const limit = maxInboxes(c.env);

  const respond = async (address: string) => {
    const inbox = await getInbox(c.env.DB, address);
    return c.json({ ...inbox!, created_at: toIsoUtc(inbox!.created_at) }, 201);
  };

  if (localPart) {
    const address = `${localPart}@${domain}`;

    // Re-claiming an address this session already holds must stay idempotent
    // even at the limit, otherwise a retry looks like abuse.
    if (await isInboxInSession(c.env.DB, s.sid, address)) {
      return respond(address);
    }

    if ((await countSessionInboxes(c.env.DB, s.sid)) >= limit) {
      return c.json({ error: `Session limit reached (${limit} inboxes). Delete one first.` }, 429);
    }

    if (await inboxExists(c.env.DB, address)) {
      // Claiming a free address is convenient; claiming somebody else's inbox
      // handed over their mail. Only unowned addresses can be claimed now.
      const others = await countOtherSessionsForInbox(c.env.DB, address, s.sid);
      if (others > 0) {
        return c.json({ error: 'Address is already in use by another session' }, 409);
      }
    } else {
      await createInbox(c.env.DB, address);
    }

    await linkInboxToSession(c.env.DB, s.sid, address);
    return respond(address);
  }

  if ((await countSessionInboxes(c.env.DB, s.sid)) >= limit) {
    return c.json({ error: `Session limit reached (${limit} inboxes). Delete one first.` }, 429);
  }

  const address = await generateUniqueAddress((addr) => inboxExists(c.env.DB, addr), domain);
  await createInbox(c.env.DB, address);
  await linkInboxToSession(c.env.DB, s.sid, address);
  return respond(address);
});

// ---- DELETE /api/inboxes/:address ----
api.delete('/inboxes/:address', async (c) => {
  const s = requireSession(c);
  if (!s.ok) return c.json({ error: s.error }, 400);

  const address = parseAddressParam(c);
  await unlinkInboxFromSession(c.env.DB, s.sid, address);
  return c.json({ ok: true });
});

// ---- GET /api/inboxes/:address/messages ----
api.get('/inboxes/:address/messages', async (c) => {
  const s = requireSession(c);
  if (!s.ok) return c.json({ error: s.error }, 400);

  const address = parseAddressParam(c);

  if (!(await isInboxInSession(c.env.DB, s.sid, address))) {
    return c.json({ error: 'Inbox not in this session' }, 403);
  }

  const limitParam = Number.parseInt(c.req.query('limit') ?? '', 10);
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, 1), MAX_MESSAGE_LIMIT)
    : DEFAULT_MESSAGE_LIMIT;
  const offsetParam = Number.parseInt(c.req.query('offset') ?? '', 10);
  const offset = Number.isFinite(offsetParam) && offsetParam > 0 ? offsetParam : 0;

  const messages = await getMessages(c.env.DB, address, limit, offset);
  return c.json(messages.map(m => ({ ...m, received_at: toIsoUtc(m.received_at) })));
});

export default api;
