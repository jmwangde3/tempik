import type { D1Database } from '@cloudflare/workers-types';

export interface Inbox {
  address: string;
  created_at: string;
}

export interface Message {
  id: string;
  inbox_address: string;
  from_address: string;
  subject: string;
  body: string;
  received_at: string;
}

export interface Session {
  id: string;
  created_at: string;
}

// ---- Inboxes ----

export async function getInbox(db: D1Database, address: string): Promise<Inbox | null> {
  return db.prepare('SELECT * FROM inboxes WHERE address = ?').bind(address).first<Inbox>();
}

export async function createInbox(db: D1Database, address: string): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO inboxes (address) VALUES (?)').bind(address).run();
}

export async function inboxExists(db: D1Database, address: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 FROM inboxes WHERE address = ? LIMIT 1').bind(address).first();
  return !!row;
}

export async function getSessionInboxes(db: D1Database, sessionId: string): Promise<Inbox[]> {
  return db
    .prepare(
      `SELECT i.* FROM inboxes i
       INNER JOIN session_inboxes si ON si.inbox_address = i.address
       WHERE si.session_id = ?
       ORDER BY i.created_at DESC`
    )
    .bind(sessionId)
    .all<Inbox>()
    .then((r) => r.results);
}

export async function countSessionInboxes(db: D1Database, sessionId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM session_inboxes WHERE session_id = ?')
    .bind(sessionId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * How many sessions other than this one have the address linked.
 *
 * `POST /api/inboxes` used to attach any existing address to the caller, so
 * knowing (or guessing) an address was enough to read its mail. Addresses are
 * short word pairs, so enumeration is realistic.
 */
export async function countOtherSessionsForInbox(
  db: D1Database,
  address: string,
  sessionId: string
): Promise<number> {
  const row = await db
    .prepare(
      'SELECT COUNT(*) AS n FROM session_inboxes WHERE inbox_address = ? AND session_id <> ?'
    )
    .bind(address, sessionId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// ---- Messages ----

/**
 * Explicit column list: `SELECT *` would return whatever is added later, and
 * the rows carry the full body. `limit` keeps one spam-flooded inbox from
 * turning a poll into a multi-megabyte response.
 */
export async function getMessages(
  db: D1Database,
  inboxAddress: string,
  limit = 50,
  offset = 0
): Promise<Message[]> {
  return db
    .prepare(
      `SELECT id, inbox_address, from_address, subject, body, received_at
         FROM messages
        WHERE inbox_address = ?
        ORDER BY received_at DESC
        LIMIT ? OFFSET ?`
    )
    .bind(inboxAddress, limit, offset)
    .all<Message>()
    .then((r) => r.results);
}

export async function insertMessage(
  db: D1Database,
  msg: Omit<Message, 'received_at'>
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO messages (id, inbox_address, from_address, subject, body)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(msg.id, msg.inbox_address, msg.from_address, msg.subject, msg.body)
    .run();
}

// ---- Sessions ----

export async function ensureSession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO sessions (id) VALUES (?)').bind(sessionId).run();
}

export async function sessionExists(db: D1Database, sessionId: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 FROM sessions WHERE id = ? LIMIT 1').bind(sessionId).first();
  return !!row;
}

// ---- Session-Inbox links ----

export async function linkInboxToSession(
  db: D1Database,
  sessionId: string,
  address: string
): Promise<void> {
  await db
    .prepare(
      'INSERT OR IGNORE INTO session_inboxes (session_id, inbox_address) VALUES (?, ?)'
    )
    .bind(sessionId, address)
    .run();
}

export async function unlinkInboxFromSession(
  db: D1Database,
  sessionId: string,
  address: string
): Promise<void> {
  await db
    .prepare('DELETE FROM session_inboxes WHERE session_id = ? AND inbox_address = ?')
    .bind(sessionId, address)
    .run();
}

export async function isInboxInSession(
  db: D1Database,
  sessionId: string,
  address: string
): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM session_inboxes WHERE session_id = ? AND inbox_address = ? LIMIT 1')
    .bind(sessionId, address)
    .first();
  return !!row;
}

// ---- Retention ----

export interface PurgeResult {
  messages: number;
  inboxes: number;
  sessions: number;
}

/**
 * Nothing ever deleted a row: `DELETE /api/inboxes/:address` only removes the
 * session link, and every inbox ever created (plus every message ever received)
 * stayed in D1 forever. Left alone the database grows without bound.
 *
 * Order matters because foreign keys are enforced: links → messages → inboxes,
 * and an inbox/ session is only dropped once nothing references it.
 */
export async function purgeOldData(db: D1Database, retentionDays: number): Promise<PurgeResult> {
  const days = Math.max(1, Math.floor(retentionDays));
  const cutoff = `-${days} days`;

  const messages = await db
    .prepare("DELETE FROM messages WHERE received_at < datetime('now', ?)")
    .bind(cutoff)
    .run();

  await db
    .prepare(
      `DELETE FROM session_inboxes
        WHERE inbox_address IN (SELECT address FROM inboxes WHERE created_at < datetime('now', ?))
          AND inbox_address NOT IN (SELECT inbox_address FROM messages)`
    )
    .bind(cutoff)
    .run();

  const inboxes = await db
    .prepare(
      `DELETE FROM inboxes
        WHERE created_at < datetime('now', ?)
          AND address NOT IN (SELECT inbox_address FROM messages)
          AND address NOT IN (SELECT inbox_address FROM session_inboxes)`
    )
    .bind(cutoff)
    .run();

  const sessions = await db
    .prepare(
      `DELETE FROM sessions
        WHERE created_at < datetime('now', ?)
          AND id NOT IN (SELECT session_id FROM session_inboxes)`
    )
    .bind(cutoff)
    .run();

  return {
    messages: messages.meta.changes ?? 0,
    inboxes: inboxes.meta.changes ?? 0,
    sessions: sessions.meta.changes ?? 0,
  };
}
