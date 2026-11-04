/**
 * Minimal HTML → plain text conversion.
 *
 * The web UI renders message bodies with `textContent`, and the API is consumed
 * by scripts that just want the verification code. Storing raw HTML meant the
 * UI had to inject it as innerHTML — which turned every inbound email into a
 * stored-XSS vector. Bodies are flattened to text here so no consumer ever
 * needs to render markup.
 *
 * Intentionally not a full parser: no DOM in a Worker, and correctness only
 * needs to cover what mail templates actually use.
 */

const DROP_ELEMENTS = /<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1>/gi;
const COMMENTS = /<!--[\s\S]*?-->/g;
const LINE_BREAKS = /<br\s*\/?>/gi;
const BLOCK_ENDS =
  /<\/(?:p|div|section|article|header|footer|tr|li|h[1-6]|blockquote|table|ul|ol|pre|figure)>/gi;
const ANCHOR =
  /<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;
const ANY_TAG = /<[^>]*>/g;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? match : named;
  });
}

function stripTags(input: string): string {
  return input.replace(ANY_TAG, '');
}

export function htmlToText(html: string): string {
  if (!html) return '';

  let text = html.replace(COMMENTS, '');
  text = text.replace(DROP_ELEMENTS, '');

  // Keep the target of a link when the visible label does not already show it,
  // otherwise verification links become unclickable orphans.
  text = text.replace(ANCHOR, (_match, double, single, inner: string) => {
    const href = String(double ?? single ?? '').trim();
    const label = stripTags(inner).trim();
    if (!href || href.startsWith('#')) return label;
    return label && label !== href ? `${label} (${href})` : href || label;
  });

  text = text.replace(LINE_BREAKS, '\n');
  text = text.replace(BLOCK_ENDS, '\n');
  text = stripTags(text);
  text = decodeEntities(text);

  return text
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
