import { describe, expect, it } from 'vitest';
import { toIsoUtc } from '../src/utils/time';

describe('toIsoUtc', () => {
  // D1's datetime('now') format. Browsers parse this as local time, which is
  // exactly the bug this helper exists to prevent.
  it('marks naive SQLite timestamps as UTC', () => {
    expect(toIsoUtc('2026-11-04 13:26:32')).toBe('2026-11-04T13:26:32Z');
  });

  it('handles fractional seconds', () => {
    expect(toIsoUtc('2026-11-04 13:26:32.123')).toBe('2026-11-04T13:26:32.123Z');
  });

  it('leaves values that already carry a zone alone', () => {
    expect(toIsoUtc('2026-11-04T13:26:32Z')).toBe('2026-11-04T13:26:32.000Z');
    expect(toIsoUtc('2026-11-04T21:26:32+08:00')).toBe('2026-11-04T13:26:32.000Z');
  });

  it('passes through empty values as null', () => {
    expect(toIsoUtc(null)).toBeNull();
    expect(toIsoUtc(undefined)).toBeNull();
    expect(toIsoUtc('')).toBeNull();
  });

  it('does not throw on unparseable input', () => {
    expect(toIsoUtc('not a date')).toBe('not a date');
  });
});
