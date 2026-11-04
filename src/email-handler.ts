import PostalMime from 'postal-mime';
import type { D1Database } from '@cloudflare/workers-types';
import { createInbox, inboxExists, insertMessage } from './db/queries';
import { htmlToText } from './utils/html-to-text';

export interface EmailHandlerEnv {
  DB: D1Database;
  MAIL_DOMAIN: string;
}

/** D1 rows top out around 1 MB; a 20 MB newsletter would fail the insert. */
const MAX_BODY_CHARS = 100_000;
const MAX_SUBJECT_CHARS = 400;

function truncate(value: string, max: number, marker: string): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n\n${marker}`;
}

/**
 * Handles inbound email via Cloudflare Email Worker.
 * Called for every email received at any @<MAIL_DOMAIN> address.
 */
export async function handleEmail(message: ForwardableEmailMessage, env: EmailHandlerEnv): Promise<void> {
  const to = message.to.toLowerCase().trim();
  const from = message.from.toLowerCase().trim();

  console.log(`[email] Received from=${from} to=${to}`);

  try {
    const parser = new PostalMime();
    const parsed = await parser.parse(message.raw);

    const subject = truncate(
      (parsed.subject || '(no subject)').replace(/[\r\n\t]+/g, ' ').trim(),
      MAX_SUBJECT_CHARS,
      '[subject truncated]'
    );

    // Store plain text only. When a mail has no text part the HTML is flattened
    // here, because the web UI renders bodies with textContent — keeping raw
    // HTML would mean injecting it as innerHTML, which is stored XSS.
    const body = truncate(
      parsed.text?.trim() || htmlToText(parsed.html || ''),
      MAX_BODY_CHARS,
      '[message truncated]'
    );

    const db = env.DB;

    // Auto-create inbox if doesn't exist
    if (!(await inboxExists(db, to))) {
      await createInbox(db, to);
      console.log(`[email] Created new inbox: ${to}`);
    }

    const msgId = `msg_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    await insertMessage(db, {
      id: msgId,
      inbox_address: to,
      from_address: from,
      subject,
      body,
    });

    console.log(`[email] Stored message ${msgId} for ${to} (${body.length} chars)`);
  } catch (err) {
    console.error(`[email] Failed to process email for ${to}:`, err);
    // Don't throw — we don't want to bounce; just log
  }
}
