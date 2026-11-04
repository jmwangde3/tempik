/**
 * D1 stores timestamps as SQLite's `datetime('now')` → `2026-11-04 13:26:32`,
 * which is UTC but carries no timezone marker.
 *
 * `new Date("2026-11-04 13:26:32")` is parsed as *local* time by every browser,
 * so the UI showed UTC clocks as if they were local — eight hours behind for a
 * GMT+8 visitor.
 *
 * The column format is left alone (changing it would break `ORDER BY` against
 * existing rows); values are normalised to ISO-8601 UTC on the way out instead.
 */

const SQLITE_DATETIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
const HAS_ZONE = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;

export function toIsoUtc(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  if (SQLITE_DATETIME.test(raw) && !HAS_ZONE.test(raw)) {
    return `${raw.replace(' ', 'T')}Z`;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
}
