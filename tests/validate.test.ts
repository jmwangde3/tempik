import { describe, expect, it } from 'vitest';
import {
  isValidLocalPart,
  isValidSessionId,
  normalizeDomain,
  normalizeLocalPart,
} from '../src/utils/validate';

describe('isValidLocalPart', () => {
  it.each(['a', 'ab', 'kopihujan23', 'a.b', 'a_b', 'a-b', 'user1', 'x'.repeat(64)])(
    'accepts %s',
    (value) => {
      expect(isValidLocalPart(value)).toBe(true);
    }
  );

  // Every one of these was accepted by the old API and stored as an inbox that
  // could never receive mail.
  it.each([
    ['', 'empty'],
    ['a b', 'space'],
    ['x@y', 'extra @'],
    ['<img src=x>', 'markup'],
    ['a.@b', 'dot before @'],
    ['-lead', 'leading dash'],
    ['trail-', 'trailing dash'],
    ['_lead', 'leading underscore'],
    ['a..b', 'double dot'],
    ['UPPER', 'uppercase (normalised before validation)'],
    ['x'.repeat(65), 'too long'],
    ['名前', 'non-ascii'],
  ])('rejects %s (%s)', (value) => {
    expect(isValidLocalPart(value)).toBe(false);
  });
});

describe('normalizeLocalPart', () => {
  it('lowercases and trims', () => {
    expect(normalizeLocalPart('  KoPi  ')).toBe('kopi');
  });

  it('returns null for non-strings', () => {
    expect(normalizeLocalPart(undefined)).toBeNull();
    expect(normalizeLocalPart(42)).toBeNull();
    expect(normalizeLocalPart({})).toBeNull();
  });
});

describe('isValidSessionId', () => {
  const valid = 'd2cb2bfb-a5e0-418a-83d4-a1ebf01868b8';

  it('accepts a UUID', () => {
    expect(isValidSessionId(valid)).toBe(true);
    expect(isValidSessionId(valid.toUpperCase())).toBe(true);
  });

  it.each(['', 'x', 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz', 'a'.repeat(300), '1-2-3-4-5'])(
    'rejects %s',
    (value) => {
      expect(isValidSessionId(value)).toBe(false);
    }
  );
});

describe('normalizeDomain', () => {
  const allowed = ['example.com', 'mail.example.org'];

  it('matches case-insensitively and ignores padding', () => {
    expect(normalizeDomain('EXAMPLE.COM ', allowed)).toBe('example.com');
  });

  it('rejects domains outside the allow-list', () => {
    expect(normalizeDomain('evil.com', allowed)).toBeNull();
    expect(normalizeDomain('a,example.com', allowed)).toBeNull();
    expect(normalizeDomain('', allowed)).toBeNull();
  });
});
