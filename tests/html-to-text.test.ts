import { describe, expect, it } from 'vitest';
import { htmlToText } from '../src/utils/html-to-text';

describe('htmlToText', () => {
  it('drops script and style bodies entirely', () => {
    const html = '<style>body{color:red}</style><p>hello</p><script>alert(1)</script>';
    expect(htmlToText(html)).toBe('hello');
  });

  it('removes event handlers instead of leaving markup behind', () => {
    const html = '<p>hi</p><img src=x onerror="window.pwned=1">';
    const text = htmlToText(html);
    expect(text).toBe('hi');
    expect(text).not.toContain('<');
  });

  it('keeps a link target as text when the label does not show it', () => {
    const html = '<a href="https://qoder.com/verify?t=1">Verify</a>';
    expect(htmlToText(html)).toBe('Verify (https://qoder.com/verify?t=1)');
  });

  it('does not duplicate a link whose label is the url', () => {
    const html = '<a href="https://x.test/a">https://x.test/a</a>';
    expect(htmlToText(html)).toBe('https://x.test/a');
  });

  it('turns block boundaries into newlines', () => {
    const html = '<p>one</p><p>two</p><div>three</div>';
    expect(htmlToText(html)).toBe('one\ntwo\nthree');
  });

  it('decodes entities', () => {
    expect(htmlToText('<p>a &amp; b &lt;tag&gt; &#39;q&#39; &#x2713;</p>')).toBe(
      "a & b <tag> 'q' ✓"
    );
  });

  it('collapses runs of blank lines and nbsp', () => {
    expect(htmlToText('<p>a</p><p></p><p></p><p>b</p>')).toBe('a\n\nb');
    expect(htmlToText('a&nbsp;&nbsp; b')).toBe('a b');
  });

  it('keeps a verification code readable after flattening', () => {
    const html = `
      <html><head><title>Verify</title></head>
      <body><p>你的邮箱验证码</p><div style="font-size:32px">507487</div>
      <p>验证码有效期 10 分钟。</p></body></html>`;
    const text = htmlToText(html);
    expect(text).toContain('507487');
    expect(text).toMatch(/507487/);
  });

  it('returns empty string for empty input', () => {
    expect(htmlToText('')).toBe('');
  });
});
